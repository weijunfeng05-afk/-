import asyncio
import hashlib
import json
import time
import uuid
from contextlib import suppress
from pathlib import Path
from .domain import AppError, Requirements, PARSER_VERSION, PROMPT_VERSION, SCORING_VERSION, validate_resume, score_match
from .files import extract, redact_blocks
from .model import ModelAdapter
from .storage import dumps

LEASE_SECONDS = 45


def parse_version(config):
    return f'{PARSER_VERSION}:{PROMPT_VERSION}:{config["config_version"]}:{config["model"]}'


def enqueue(db, kind, job, resume_id, config, force=False, attempt=1):
    payload = {'job_version': job['version'], 'jd_text': job['jd_text'], 'requirements': json.loads(job['requirements']),
               'config_version': config['config_version'], 'model': config['model'], 'parse_version': parse_version(config),
               'prompt_version': PROMPT_VERSION, 'scoring_version': SCORING_VERSION}
    key = hashlib.sha256(dumps([kind, job['id'], resume_id, payload]).encode()).hexdigest()
    existing = db.execute("SELECT id FROM analysis_tasks WHERE input_key=? AND status IN ('queued','running')", (key,)).fetchone()
    if not existing and not force:
        existing = db.execute("SELECT id FROM analysis_tasks WHERE input_key=? AND status='succeeded' ORDER BY created_at DESC LIMIT 1", (key,)).fetchone()
    if existing:
        return {'task_id': existing['id'], 'reused': True}
    task_id, now = uuid.uuid4().hex, time.time()
    db.execute('INSERT INTO analysis_tasks (id,task_type,input_key,job_id,resume_id,payload,status,attempt,created_at,updated_at) VALUES (?,?,?,?,?,?,\'queued\',?,?,?)',
               (task_id, kind, key, job['id'], resume_id, dumps(payload), attempt, now, now))
    return {'task_id': task_id, 'reused': False}


class Worker:
    def __init__(self, store, configs, factory=ModelAdapter):
        self.store, self.configs, self.factory = store, configs, factory
        self.stopping = False

    def recover(self):
        with self.store.connect(write=True) as db:
            db.execute("UPDATE analysis_tasks SET status='interrupted',stage='执行中断',token=NULL,error=?,updated_at=? WHERE status='running' AND lease_until < ?",
                       (dumps({'code': 'interrupted', 'message': '执行中断，可以重试。', 'retryable': True}), time.time(), time.time()))

    def claim(self):
        self.recover()
        with self.store.connect(write=True) as db:
            # A database-wide active lease keeps execution single-file even if two servers start.
            if db.execute("SELECT 1 FROM analysis_tasks WHERE status='running' AND lease_until>=?", (time.time(),)).fetchone():
                return None
            row = db.execute("SELECT * FROM analysis_tasks WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
            if not row:
                return None
            token = uuid.uuid4().hex
            db.execute("UPDATE analysis_tasks SET status='running',token=?,lease_until=?,updated_at=? WHERE id=?", (token, time.time() + LEASE_SECONDS, time.time(), row['id']))
            return {**dict(row), 'token': token}

    async def heartbeat(self, task):
        while True:
            await asyncio.sleep(10)
            with self.store.connect(write=True) as db:
                db.execute("UPDATE analysis_tasks SET lease_until=?,updated_at=? WHERE id=? AND token=? AND status='running'", (time.time() + LEASE_SECONDS, time.time(), task['id'], task['token']))

    def stage(self, task, label):
        with self.store.connect(write=True) as db:
            db.execute('UPDATE analysis_tasks SET stage=?,updated_at=? WHERE id=? AND token=?', (label, time.time(), task['id'], task['token']))

    async def run_once(self):
        task = self.claim()
        if not task:
            return False
        beat = asyncio.create_task(self.heartbeat(task))
        try:
            await self.execute(task)
        except asyncio.CancelledError:
            self.fail(task, AppError('interrupted', '应用已停止，本次分析中断，请重试。', retryable=True), 'interrupted')
            raise
        except AppError as exc:
            self.fail(task, exc)
        except Exception:
            self.fail(task, AppError('analysis_failed', '分析过程发生异常，请重试；若持续失败，请检查文件和模型配置。', retryable=True))
        finally:
            beat.cancel()
            with suppress(asyncio.CancelledError):
                await beat
        return True

    def fail(self, task, exc, status='failed'):
        with self.store.connect(write=True) as db:
            db.execute('UPDATE analysis_tasks SET status=?,error=?,token=NULL,updated_at=? WHERE id=? AND token=?',
                       (status, dumps({'code': exc.code, 'message': exc.message, 'retryable': exc.retryable}), time.time(), task['id'], task['token']))

    async def execute(self, task):
        payload = json.loads(task['payload'])
        if payload.get('prompt_version') != PROMPT_VERSION or payload.get('scoring_version') != SCORING_VERSION:
            raise AppError('rules_changed', '评分规则已更新，请重试以使用当前规则。', retryable=True)
        config = self.configs.private()
        if config['config_version'] != payload['config_version']:
            raise AppError('configuration_changed', '模型配置已改变，请按新配置重新分析。', retryable=True)
        adapter = self.factory(config)
        if task['task_type'] == 'parse_jd':
            self.stage(task, '提取岗位要求')
            requirements = await adapter.parse_jd(payload['jd_text'], payload['requirements'].get('scoring_profile', 'generic'))
            # Model extraction must never change the user's selected scoring policy.
            requirements = Requirements.model_validate({**requirements.model_dump(),
                'scoring_profile': payload['requirements'].get('scoring_profile', 'generic')})
            output = {'requirements': requirements.model_dump(), 'job_version': payload['job_version']}
            with self.store.connect(write=True) as db:
                self.finish(db, task, output)
            return
        resume = self.store.one('SELECT * FROM resumes WHERE id=?', (task['resume_id'],))
        if not resume:
            return
        self.stage(task, '提取文件文字')
        blocks = json.loads(resume['text_blocks']) if resume['text_blocks'] else await asyncio.to_thread(extract, resume['filename'], Path(resume['file_path']).read_bytes())
        with self.store.connect(write=True) as db:
            db.execute('UPDATE resumes SET text_blocks=? WHERE id=?', (dumps(blocks), resume['id']))
        version = payload['parse_version']
        self.stage(task, '结构化解析')
        if resume['parsed_json'] and resume['parse_version'] == version:
            parsed = json.loads(resume['parsed_json'])
        else:
            # Identity is read only for display; scoring receives a second, redacted view.
            parsed_model = await adapter.parse_resume(redact_blocks(blocks, hide_identity=False))
            validate_resume(parsed_model, blocks)
            parsed = parsed_model.model_dump()
            with self.store.connect(write=True) as db:
                db.execute('UPDATE resumes SET parsed_json=?,parse_version=?,name=? WHERE id=?', (dumps(parsed), version, parsed['name'], resume['id']))
        name = parsed.get('name', '')
        safe_blocks = redact_blocks(blocks, name)
        safe_parsed = {k: v for k, v in parsed.items() if k != 'name'}
        # The parser's fact prose may contain identity too; redact all strings recursively.
        def sanitize(value):
            if isinstance(value, str):
                return redact_blocks([{'id': '', 'text': value}], name)[0]['text']
            if isinstance(value, list):
                return [sanitize(v) for v in value]
            if isinstance(value, dict):
                return {k: sanitize(v) for k, v in value.items()}
            return value
        safe_parsed = sanitize(safe_parsed)
        self.stage(task, '岗位匹配')
        requirements = Requirements.model_validate(payload['requirements'])
        evaluation = await adapter.evaluate_match(requirements, safe_parsed, safe_blocks)
        self.stage(task, '校验证据与计分')
        result = score_match(requirements, evaluation, safe_blocks)
        # Do not publish transformed/redacted strings as original-file quotations.
        score_match(requirements, evaluation, blocks)
        result_id = uuid.uuid4().hex
        with self.store.connect(write=True) as db:
            valid = db.execute("SELECT 1 FROM analysis_tasks WHERE id=? AND token=? AND status='running' AND lease_until>=?", (task['id'], task['token'], time.time())).fetchone()
            if not valid or not db.execute('SELECT 1 FROM resumes WHERE id=?', (resume['id'],)).fetchone():
                return
            db.execute('INSERT INTO match_results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (result_id, task['id'], task['job_id'], resume['id'], payload['job_version'], version, config['config_version'], config['model'],
                        PROMPT_VERSION, SCORING_VERSION, dumps(payload), dumps(result), time.time()))
            self.finish(db, task, {'match_id': result_id})

    def finish(self, db, task, output):
        db.execute("UPDATE analysis_tasks SET status='succeeded',stage='已完成',output=?,token=NULL,updated_at=? WHERE id=? AND token=? AND status='running' AND lease_until>=?",
                   (dumps(output), time.time(), task['id'], task['token'], time.time()))

    async def run(self):
        while not self.stopping:
            if not await self.run_once():
                await asyncio.sleep(1)
