import asyncio
import hashlib
import json
import os
import time
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit
from fastapi import FastAPI, UploadFile, File, Form, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from pydantic import Field
from .domain import AppError, StrictModel, Requirements
from .files import extract, check_file, MAX_FILE_BYTES, MAX_TEXT_CHARS
from .storage import Store, dumps
from .model import ConfigService, ModelAdapter
from .worker import Worker, enqueue, parse_version

ROOT = Path(__file__).resolve().parents[1]


class JobInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    jd_text: str = Field(default='', max_length=MAX_TEXT_CHARS)
    requirements: Requirements = Field(default_factory=Requirements)
    confirmed: bool = False


class JobPatch(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    jd_text: str | None = Field(default=None, max_length=MAX_TEXT_CHARS)
    requirements: Requirements | None = None
    confirmed: bool | None = None
    expected_version: int = Field(ge=1)


class ConfigInput(StrictModel):
    base_url: str = Field(min_length=1, max_length=1000)
    model: str = Field(min_length=1, max_length=150)
    api_key: str = Field(default='', max_length=4000)


class MatchInput(StrictModel):
    resume_ids: list[str] = Field(min_length=1, max_length=100)
    force: bool = False


def job_view(row):
    return {**row, 'requirements': json.loads(row['requirements']), 'confirmed': bool(row['confirmed'])}


def task_view(row):
    return {k: json.loads(v) if k in ('error', 'output') and v else v for k, v in row.items() if k not in ('payload', 'token', 'input_key', 'lease_until')}


def create_app(data_dir=None, master_key=None, worker_enabled=True, model_factory=ModelAdapter):
    store = Store(data_dir or os.environ.get('RESUME_DATA_DIR', ROOT / 'data'))
    configs = ConfigService(store, master_key)
    worker = Worker(store, configs, model_factory)

    @asynccontextmanager
    async def lifespan(app):
        worker.recover()
        runner = asyncio.create_task(worker.run()) if worker_enabled else None
        yield
        if runner:
            worker.stopping = True
            runner.cancel()
            with suppress(asyncio.CancelledError):
                await runner

    app = FastAPI(title='简历筛选助手', version='0.1.0', lifespan=lifespan)
    app.state.store, app.state.worker, app.state.configs = store, worker, configs

    def error_response(request, code, message, status, retryable=False):
        return JSONResponse({'code': code, 'message': message, 'retryable': retryable, 'request_id': getattr(request.state, 'request_id', uuid.uuid4().hex)}, status_code=status)

    @app.middleware('http')
    async def local_guard(request, call_next):
        request.state.request_id = uuid.uuid4().hex
        allowed = ('127.0.0.1', 'localhost', '::1') + (('testserver',) if not worker_enabled else ())
        if request.url.hostname not in allowed:
            return error_response(request, 'invalid_host', '仅允许本机访问。', 403)
        origin = request.headers.get('origin')
        if origin and origin != str(request.base_url).rstrip('/'):
            dev_origin = urlsplit(origin)
            if dev_origin.hostname not in ('127.0.0.1', 'localhost') or dev_origin.port != 5173 or dev_origin.scheme != 'http':
                return error_response(request, 'invalid_origin', '请求来源不受信任。', 403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['X-Frame-Options'] = 'DENY'
        if request.url.path.startswith('/api'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(AppError)
    async def app_error(request, exc):
        return error_response(request, exc.code, exc.message, exc.status, exc.retryable)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return error_response(request, 'invalid_input', '输入格式不正确，请检查必填内容、长度、版本和字段类型。', 422)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return error_response(request, 'http_error', '请求路径、方法或文件格式不正确。', exc.status_code)

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        return error_response(request, 'internal_error', '本机服务暂时无法完成请求，请重试。', 500, True)

    def need_job(job_id):
        row = store.one('SELECT * FROM jobs WHERE id=?', (job_id,))
        if not row:
            raise AppError('not_found', '岗位不存在。', 404)
        return row

    def need_resume(resume_id):
        row = store.one('SELECT * FROM resumes WHERE id=?', (resume_id,))
        if not row:
            raise AppError('not_found', '简历不存在或已删除。', 404)
        return row

    @app.get('/api/health')
    def health():
        return {'ok': True, 'version': '0.1.0', 'model_configured': configs.public()['key_set']}

    @app.get('/api/model-config')
    def read_config():
        return configs.public()

    @app.put('/api/model-config')
    def save_config(body: ConfigInput):
        return configs.save(body.base_url, body.model, body.api_key)

    @app.post('/api/model-config/test')
    async def test_config():
        return await model_factory(configs.private()).test_connection()

    @app.get('/api/jobs')
    def list_jobs():
        rows = store.all('SELECT j.*,(SELECT COUNT(*) FROM job_resumes WHERE job_id=j.id) AS resume_count, (SELECT COUNT(*) FROM analysis_tasks WHERE job_id=j.id AND status IN (\'queued\',\'running\')) AS active_count FROM jobs j ORDER BY updated_at DESC')
        return [job_view(r) for r in rows]

    @app.post('/api/jobs', status_code=201)
    def create_job(body: JobInput):
        if body.confirmed and not body.requirements.active():
            raise AppError('empty_requirements', '确认前请至少填写一个评分维度的岗位要求。')
        job_id, now = uuid.uuid4().hex, time.time()
        with store.connect(write=True) as db:
            db.execute('INSERT INTO jobs VALUES (?,?,?,?,1,?,?,?)', (job_id, body.name, body.jd_text, dumps(body.requirements.model_dump()), int(body.confirmed), now, now))
        return job_view(need_job(job_id))

    @app.get('/api/jobs/{job_id}')
    def get_job(job_id: str):
        return job_view(need_job(job_id))

    @app.patch('/api/jobs/{job_id}')
    def patch_job(job_id: str, body: JobPatch):
        with store.connect(write=True) as db:
            old = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not old:
                raise AppError('not_found', '岗位不存在。', 404)
            if old['version'] != body.expected_version:
                raise AppError('version_conflict', '岗位已在其他页面更新，请刷新后重试。', 409)
            name = body.name if body.name is not None else old['name']
            text = body.jd_text if body.jd_text is not None else old['jd_text']
            req = body.requirements or Requirements.model_validate_json(old['requirements'])
            encoded = dumps(req.model_dump())
            changed = text != old['jd_text'] or encoded != old['requirements']
            confirmed = body.confirmed if body.confirmed is not None else (False if changed else bool(old['confirmed']))
            if confirmed and not req.active():
                raise AppError('empty_requirements', '确认前请至少填写一个评分维度的岗位要求。')
            version = old['version'] + int(changed or confirmed != bool(old['confirmed']))
            db.execute('UPDATE jobs SET name=?,jd_text=?,requirements=?,confirmed=?,version=?,updated_at=? WHERE id=?', (name, text, encoded, int(confirmed), version, time.time(), job_id))
        return job_view(need_job(job_id))

    @app.post('/api/files/extract')
    async def extract_jd(file: UploadFile = File(...)):
        data = await file.read(MAX_FILE_BYTES + 1)
        await file.close()
        blocks = await asyncio.to_thread(extract, file.filename or '', data)
        return {'text': '\n\n'.join(b['text'] for b in blocks), 'text_blocks': blocks}

    @app.post('/api/jobs/{job_id}/parse', status_code=202)
    def parse_job(job_id: str):
        config = configs.private()
        with store.connect(write=True) as db:
            job = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not job:
                raise AppError('not_found', '岗位不存在。', 404)
            if not job['jd_text'].strip():
                raise AppError('empty_jd', '请先填写或上传 JD。')
            return enqueue(db, 'parse_jd', job, None, config, force=True)

    @app.post('/api/resumes', status_code=201)
    async def upload_resumes(job_id: str = Form(...), files: list[UploadFile] = File(...)):
        need_job(job_id)
        if len(files) > 20:
            raise AppError('too_many_files', '每批最多上传 20 份简历。')
        accepted = []
        for file in files:
            filename = (file.filename or '未命名').replace('\\', '/').split('/')[-1][:200]
            path = None
            try:
                data = await file.read(MAX_FILE_BYTES + 1)
                ext = check_file(filename, data)
                digest = hashlib.sha256(data).hexdigest()
                with store.connect(write=True) as db:
                    old = db.execute('SELECT id FROM resumes WHERE file_hash=?', (digest,)).fetchone()
                    if old:
                        resume_id = old['id']
                    else:
                        resume_id = uuid.uuid4().hex
                        path = store.directory / 'files' / (resume_id + ext)
                        path.write_bytes(data)
                        db.execute('INSERT INTO resumes (id,file_hash,filename,file_path,created_at) VALUES (?,?,?,?,?)', (resume_id, digest, filename, str(path), time.time()))
                    db.execute('INSERT OR IGNORE INTO job_resumes VALUES (?,?)', (job_id, resume_id))
                accepted.append({'filename': filename, 'resume_id': resume_id, 'reused': bool(old), 'error': None})
            except AppError as exc:
                if path:
                    path.unlink(missing_ok=True)
                accepted.append({'filename': filename, 'error': {'code': exc.code, 'message': exc.message}})
            except Exception:
                if path:
                    path.unlink(missing_ok=True)
                accepted.append({'filename': filename, 'error': {'code': 'upload_failed', 'message': '文件保存失败，请重试。'}})
            finally:
                await file.close()
        return {'files': accepted}

    @app.get('/api/jobs/{job_id}/resumes')
    def job_resumes(job_id: str):
        job = need_job(job_id)
        rows = store.all('SELECT r.id,r.filename,r.name,r.created_at FROM resumes r JOIN job_resumes jr ON r.id=jr.resume_id WHERE jr.job_id=? ORDER BY r.created_at DESC', (job_id,))
        for row in rows:
            task = store.one("SELECT * FROM analysis_tasks WHERE job_id=? AND resume_id=? ORDER BY created_at DESC LIMIT 1", (job_id, row['id']))
            result = store.one('SELECT * FROM match_results WHERE job_id=? AND resume_id=? ORDER BY created_at DESC LIMIT 1', (job_id, row['id']))
            row['task'] = task_view(task) if task else None
            row['match'] = result_view(result, job) if result else None
        return rows

    @app.get('/api/resumes/{resume_id}')
    def get_resume(resume_id: str):
        row = need_resume(resume_id)
        return {k: json.loads(v) if k in ('text_blocks', 'parsed_json') and v else v for k, v in row.items() if k not in ('file_path', 'file_hash')}

    @app.get('/api/resumes/{resume_id}/file')
    def get_file(resume_id: str):
        row = need_resume(resume_id)
        if not Path(row['file_path']).is_file():
            raise AppError('file_missing', '本地原文件不存在。', 404)
        return FileResponse(row['file_path'], filename=row['filename'], content_disposition_type='attachment')

    @app.delete('/api/resumes/{resume_id}')
    def delete_resume(resume_id: str):
        with store.connect(write=True) as db:
            row = db.execute('SELECT * FROM resumes WHERE id=?', (resume_id,)).fetchone()
            if not row:
                raise AppError('not_found', '简历不存在。', 404)
            # The FK cascade removes the running lease, so an in-flight worker cannot commit.
            db.execute('DELETE FROM resumes WHERE id=?', (resume_id,))
        try:
            Path(row['file_path']).unlink(missing_ok=True)
        except OSError:
            return {'deleted': True, 'warning': '记录已删除，但原文件被其他程序占用，请稍后清理 data/files 中对应文件。'}
        return {'deleted': True}

    @app.post('/api/jobs/{job_id}/matches', status_code=202)
    def start_matches(job_id: str, body: MatchInput):
        config = configs.private()
        with store.connect(write=True) as db:
            job = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not job:
                raise AppError('not_found', '岗位不存在。', 404)
            if not job['confirmed']:
                raise AppError('unconfirmed_requirements', '请先确认并保存岗位要求。')
            if not Requirements.model_validate_json(job['requirements']).active():
                raise AppError('empty_requirements', '请完善岗位评分要求。')
            tasks = []
            for resume_id in dict.fromkeys(body.resume_ids):
                if not db.execute('SELECT 1 FROM resumes WHERE id=?', (resume_id,)).fetchone():
                    raise AppError('not_found', '提交的简历不存在或已删除。', 404)
                db.execute('INSERT OR IGNORE INTO job_resumes VALUES (?,?)', (job_id, resume_id))
                tasks.append({'resume_id': resume_id, **enqueue(db, 'match', job, resume_id, config, body.force)})
        return {'tasks': tasks}

    @app.get('/api/tasks')
    def tasks(job_id: str, limit: int = Query(200, ge=1, le=500)):
        need_job(job_id)
        return [task_view(t) for t in store.all('SELECT * FROM analysis_tasks WHERE job_id=? ORDER BY created_at DESC LIMIT ?', (job_id, limit))]

    @app.get('/api/tasks/{task_id}')
    def get_task(task_id: str):
        task = store.one('SELECT * FROM analysis_tasks WHERE id=?', (task_id,))
        if not task:
            raise AppError('not_found', '任务不存在。', 404)
        return task_view(task)

    @app.post('/api/tasks/{task_id}/retry', status_code=202)
    def retry_task(task_id: str):
        config = configs.private()
        with store.connect(write=True) as db:
            old = db.execute('SELECT * FROM analysis_tasks WHERE id=?', (task_id,)).fetchone()
            if not old:
                raise AppError('not_found', '任务不存在。', 404)
            if old['status'] not in ('failed', 'interrupted'):
                raise AppError('invalid_task_state', '只有失败或中断任务可以重试。', 409)
            job = db.execute('SELECT * FROM jobs WHERE id=?', (old['job_id'],)).fetchone()
            if old['task_type'] == 'match' and not job['confirmed']:
                raise AppError('unconfirmed_requirements', '请先确认当前岗位要求。')
            return enqueue(db, old['task_type'], job, old['resume_id'], config, True, old['attempt'] + 1)

    def result_view(row, job=None):
        job = job or need_job(row['job_id'])
        config = configs.public()
        stale = row['job_version'] != job['version'] or row['config_version'] != config['config_version'] or not job['confirmed']
        from .domain import PROMPT_VERSION, SCORING_VERSION
        stale = stale or row['prompt_version'] != PROMPT_VERSION or row['scoring_version'] != SCORING_VERSION or row['parse_version'] != parse_version(config)
        result = json.loads(row['result'])
        return {**{k: v for k, v in row.items() if k not in ('result', 'input_snapshot')}, **result, 'stale': bool(stale), 'input_snapshot': json.loads(row['input_snapshot'])}

    @app.get('/api/jobs/{job_id}/matches')
    def matches(job_id: str, category: str | None = None, sort: Literal['score_desc', 'score_asc', 'newest'] = 'score_desc', offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
        job = need_job(job_id)
        rows = store.all('SELECT * FROM (SELECT m.*, ROW_NUMBER() OVER (PARTITION BY resume_id ORDER BY created_at DESC) AS rn FROM match_results m WHERE job_id=?) WHERE rn=1', (job_id,))
        items = [result_view(row, job) for row in rows]
        if category:
            items = [r for r in items if r['category'] == category]
        def order(r):
            score = r['total_score'] if r['total_score'] is not None else -1
            return (r['stale'] or r['provisional'] or r['total_score'] is None, -r['created_at'] if sort == 'newest' else score if sort == 'score_asc' else -score)
        items.sort(key=order)
        return {'items': items[offset:offset + limit], 'total': len(items)}

    @app.get('/api/matches/{match_id}')
    def match_detail(match_id: str):
        row = store.one('SELECT * FROM match_results WHERE id=?', (match_id,))
        if not row:
            raise AppError('not_found', '匹配结果不存在。', 404)
        return {**result_view(row), 'resume': get_resume(row['resume_id'])}

    frontend = ROOT / 'frontend' / 'dist'
    if frontend.is_dir():
        app.mount('/', StaticFiles(directory=frontend, html=True), name='frontend')
    return app
