import {isAllowedRequestOrigin} from '@/lib/request-origin';
// 本地真实 AI 模式（NEXT_PUBLIC_AI_MODE=real）：
// 不连接 Supabase / PostgreSQL / Netlify 后台任务。数据按登录邮箱隔离，保存在内存（重启后清空）。
// 岗位分析与简历评分直接调用 DeepSeek 大模型，评分卡与「证据必须可追溯到简历原文」的校验复用生产逻辑。
import { json, AppError } from './db';
import { demoOwner } from './demo';
import { parseJobOutput, jobInput, cardSchema, validateEvaluation, type Scorecard } from './ai/schema';
import { JOB_PROMPT, resumePrompt, PROMPT_VERSION } from './ai/prompts';
import { checkFile, parseDocument } from './documents';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';

export const localAiEnabled = () => process.env.NEXT_PUBLIC_AI_MODE === 'real';

const ENDPOINT = 'https://api.deepseek.com';
const DEFAULT_JOB_MODEL = 'deepseek-v4-pro';
const DEFAULT_RESUME_MODEL = 'deepseek-flash';
const jobModel = () => process.env.DEEPSEEK_JOB_MODEL || DEFAULT_JOB_MODEL;
const resumeModel = () => process.env.DEEPSEEK_RESUME_MODEL || DEFAULT_RESUME_MODEL;
const envApiKey = () => process.env.DEEPSEEK_API_KEY || '';

// 每位登录用户可自行填写的 API 配置（密钥 + 模型）。保存在本地文件，重启后仍可恢复；
// 若某用户未填写，则回退到 .env.local 的 DEEPSEEK_API_KEY。
type AiConfig = { apiKey: string; jobModel: string; resumeModel: string };
const CONFIG_FILE = path.join(process.cwd(), '.data', 'local-ai-config.json');
const configStore = globalThis as unknown as { __xiaofengLocalAiConfigs?: Record<string, AiConfig> };
const configs = (configStore.__xiaofengLocalAiConfigs ??= {});
try {
  if (existsSync(CONFIG_FILE)) Object.assign(configs, JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
} catch { /* 忽略损坏的本地配置文件 */ }

function persistConfigs() {
  try {
    mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(configs), 'utf8');
  } catch { /* 写入失败不影响本次运行 */ }
}

function effectiveApiKey(owner: string): string {
  return configs[owner]?.apiKey || envApiKey();
}
function effectiveModel(owner: string, task: 'job' | 'resume'): string {
  const c = configs[owner];
  const model = task === 'job' ? (c?.jobModel || jobModel()) : (c?.resumeModel || resumeModel());
  return model === 'deepseek-v4-flash' ? DEFAULT_RESUME_MODEL : model;
}

// 读取请求体 JSON；格式错误时返回 400 而非 500。
async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new AppError('请求体不是有效的 JSON。', 400);
  }
}

function deepseekError(status: number, model: string): string {
  return status === 401 ? 'DeepSeek 密钥认证失败，请检查 DEEPSEEK_API_KEY 是否复制完整。'
    : status === 402 ? 'DeepSeek 账户余额不足，请充值后重试。'
    : status === 429 ? 'DeepSeek 请求过于频繁，请稍后重试。'
    : status === 404 || status === 400 ? `当前账户无法使用模型「${model}」，请检查模型名称或账户权限。`
    : `DeepSeek 服务暂时不可用（${status}）`;
}

type JobProfile = { summary: string; responsibilities: string[]; keywords: string[] };
type LocalJob = {
  id: string; owner: string; name: string; department: string; location: string; level: string; notes: string;
  jd: string; profile: JobProfile; version: number; confirmed: number; generation_status: string;
  generation_error: string | null; scorecard: Scorecard | null; created: number; updated: number;
};
type LocalCandidate = {
  id: string; job_id: string; owner: string; name: string; filename: string; status: string; score: number | null;
  version: number; error: string | null; error_code: string | null; retry_count: number; created: number; updated: number;
  analysis_started_at: number | null; analysis_completed_at: number | null; mime: string; resume_text: string;
  model: string; prompt_version: string; result: unknown | null; file_bytes: Uint8Array | null;
};
type Store = { jobs: LocalJob[]; candidates: LocalCandidate[] };

const globalStore = globalThis as unknown as { __xiaofengLocalAiStores?: Record<string, Store> };
function store(owner: string): Store {
  const stores = (globalStore.__xiaofengLocalAiStores ??= {});
  stores[owner] ??= { jobs: [], candidates: [] };
  return stores[owner];
}

async function callLocalAI<T>(task: 'job' | 'resume', owner: string, system: string, input: unknown, validate: (x: unknown) => T): Promise<T> {
  const key = effectiveApiKey(owner);
  if (!key) throw new AppError('尚未配置 DeepSeek API Key：请在「API 设置」填写你自己的 DeepSeek Key，或在 .env.local 配置 DEEPSEEK_API_KEY。', 503);
  const model = effectiveModel(owner, task);
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(ENDPOINT + '/chat/completions', {
        method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }],
          response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 7000, temperature: 0.1,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new AppError(deepseekError(response.status, model), response.status === 429 || response.status >= 500 ? 503 : 422);
      const body: any = await response.json().catch(() => null);
      const content = body?.choices?.[0]?.message?.content;
      if (body?.choices?.[0]?.finish_reason === 'length') throw new AppError('AI 输出超限，请精简 JD 或简历后重试。', 422);
      if (typeof content !== 'string' || !content.trim()) throw Error('AI 未返回内容');
      const raw = JSON.parse(content);
      return validate(raw);
    } catch (e) {
      last = e;
      const retriable = !(e instanceof AppError) || e.status === 429 || e.status >= 500;
      if (!retriable || attempt === 1) {
        console.warn('[local-ai] AI 调用失败', {
          task, model, attempt: attempt + 1,
          error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
          issues: e instanceof ZodError ? e.issues.map(i => i.message) : undefined,
        });
        break;
      }
    }
  }
  if (last instanceof AppError) throw last;
  if (last instanceof ZodError) throw new AppError('AI 输出未通过校验：' + last.issues.map(i => i.message).join('；'), 422);
  if (last instanceof Error) throw new AppError('AI 输出未通过校验：' + last.message, 422);
  throw new AppError('AI 结果未通过校验或请求超时，请稍后重试。', 502);
}

async function analyzeJob(owner: string, job: LocalJob, reanalyze: boolean) {
  try {
    const out = await callLocalAI('job', owner, JOB_PROMPT, {
      name: job.name, jd: job.jd, department: job.department, location: job.location, level: job.level, notes: job.notes,
    }, x => parseJobOutput(x));
    job.profile = out.profile;
    job.scorecard = out.scorecard;
    job.generation_status = 'completed';
    job.generation_error = null;
    job.confirmed = 0; // 新生成的评分卡需要用户确认后再开始筛选
    if (reanalyze) {
      for (const c of store(owner).candidates.filter(x => x.job_id === job.id)) {
        c.status = 'scoring'; c.result = null; c.score = null; c.error = null; c.error_code = null;
        c.analysis_completed_at = null; c.version = job.version; c.updated = Date.now();
        void analyzeCandidate(owner, c);
      }
    }
  } catch (e) {
    job.generation_status = 'failed';
    job.generation_error = e instanceof Error ? e.message : '岗位分析未完成，请重试';
  } finally {
    job.updated = Date.now();
  }
}

async function analyzeCandidate(owner: string, c: LocalCandidate) {
  c.status = 'scoring'; c.analysis_started_at = Date.now(); c.updated = Date.now();
  try {
    const job = store(owner).jobs.find(j => j.id === c.job_id);
    if (!job || !job.scorecard) throw new AppError('岗位评分卡尚未生成，请先生成并确认评分卡。', 409);
    const card = job.scorecard;
    c.version = job.version;
    c.model = effectiveModel(owner, 'resume');
    c.prompt_version = PROMPT_VERSION;
    const result = await callLocalAI('resume', owner, resumePrompt(card), { job_profile: job.profile, resume: c.resume_text }, x => validateEvaluation(x, card, c.resume_text));
    c.result = result; c.status = 'completed'; c.score = result.total_score;
    c.name = result.candidate_profile.name || c.name;
    c.analysis_completed_at = Date.now(); c.error = null; c.error_code = null;
  } catch (e) {
    c.status = 'failed'; c.error = e instanceof Error ? e.message : '分析未完成，原始简历已保留。';
    c.error_code = e instanceof AppError && e.status < 500 ? 'INPUT_OR_QUOTA' : 'TRANSIENT';
  } finally {
    c.updated = Date.now();
  }
}

async function probeModel(key: string, model: string) {
  const started = Date.now();
  try {
    const response = await fetch(ENDPOINT + '/chat/completions', {
      method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Return only this JSON: {"ok":true}' }], response_format: { type: 'json_object' }, thinking: { type: 'disabled' }, max_tokens: 32 }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new AppError(deepseekError(response.status, model), 422);
    const body: any = await response.json();
    if (JSON.parse(body.choices?.[0]?.message?.content || '').ok !== true) throw Error('invalid JSON output');
    return { latency_ms: Date.now() - started, ok: true };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('连接超时或返回格式不符合要求，请稍后重试。', 422);
  }
}

function jobSummary(j: LocalJob, all: LocalCandidate[]) {
  const { scorecard, ...rest } = j;
  const rows = all.filter(c => c.job_id === j.id);
  return {
    ...rest,
    count: rows.length,
    completed: rows.filter(c => c.status === 'completed').length,
    high: rows.filter(c => c.status === 'completed' && (c.score ?? 0) >= 85).length,
    today: rows.filter(c => c.created >= Date.now() - 86_400_000).length,
  };
}

// 返回给前端的候选人数据，去掉原始文件字节等不适合进 JSON 的字段。
function publicCandidate(c: LocalCandidate) {
  const { file_bytes, ...rest } = c;
  return rest;
}

export async function localAiRequest(req: Request): Promise<Response> {
  try {
    if (!isAllowedRequestOrigin(req)) return json({ error: '无效的请求来源' }, 403);
    const parts = new URL(req.url).pathname.slice(5).split('/');
    const [kind, id, action] = parts;
    const owner = demoOwner(req);
    const s = store(owner);

    if (kind === 'status' && req.method === 'GET') return json({ ai_configured: !!effectiveApiKey(owner) });

    if (kind === 'settings' && id === 'ai') {
      const currentStatus = () => {
        const key = effectiveApiKey(owner);
        const saved = configs[owner];
        return {
          configured: !!key,
          masked_key: key ? '•••• •••• ' + key.slice(-4) : null,
          job_model: effectiveModel(owner, 'job'),
          resume_model: effectiveModel(owner, 'resume'),
          version: saved ? 1 : 0,
          updated_at: saved ? Date.now() : null,
          provider: 'DeepSeek', endpoint: ENDPOINT,
        };
      };
      if (req.method === 'GET' && !action) return json(currentStatus());
      if (req.method === 'POST' && action === 'test') {
        const body: any = await req.json().catch(() => ({}));
        const key = body?.api_key || effectiveApiKey(owner);
        if (!key) throw new AppError('请先填写 DeepSeek API Key。', 422);
        const jobM = body?.job_model || effectiveModel(owner, 'job');
        const resumeM = body?.resume_model || effectiveModel(owner, 'resume');
        const models = [...new Set([jobM, resumeM])];
        return json({ ok: true, checks: await Promise.all(models.map(async model => ({ model, ...(await probeModel(key, model)) }))) });
      }
      if (req.method === 'PUT' && !action) {
        const body: any = await req.json().catch(() => ({}));
        const key = body?.api_key || configs[owner]?.apiKey || '';
        if (!key) throw new AppError('请填写 DeepSeek API Key。', 422);
        const jobM = body?.job_model || jobModel();
        const resumeM = body?.resume_model || resumeModel();
        const checks = await Promise.all([...new Set([jobM, resumeM])].map(model => probeModel(key, model)));
        configs[owner] = { apiKey: key, jobModel: jobM, resumeModel: resumeM };
        persistConfigs();
        return json({ ...currentStatus(), checks });
      }
      if (req.method === 'DELETE' && !action) {
        delete configs[owner];
        persistConfigs();
        return json(currentStatus());
      }
    }

    if (kind === 'documents' && req.method === 'POST') {
      const fd = await req.formData();
      const file = fd.get('file');
      if (!(file instanceof File)) throw new AppError('缺少文件');
      checkFile(file);
      return json({ text: await parseDocument(await file.arrayBuffer(), file.name) });
    }

    if (kind === 'usage' && req.method === 'GET') {
      return json({ owner, jobs: s.jobs.length, job_limit: 10, candidates: s.candidates.length, candidate_limit: 200, ai_requests: s.candidates.length, ai_limit: 1000 });
    }

    if (kind === 'jobs' && !id && req.method === 'GET') return json(s.jobs.map(j => jobSummary(j, s.candidates)));

    if (kind === 'jobs' && !id && req.method === 'POST') {
      const input = jobInput.parse(await readJson(req));
      const jobId = 'job-' + crypto.randomUUID().slice(0, 8);
      const job: LocalJob = {
        id: jobId, owner, name: input.name, department: input.department, location: input.location, level: input.level, notes: input.notes,
        jd: input.jd, profile: { summary: '岗位画像生成中…', responsibilities: [], keywords: [] },
        version: 1, confirmed: 0, generation_status: 'waiting', generation_error: null, scorecard: null, created: Date.now(), updated: Date.now(),
      };
      s.jobs.unshift(job);
      void analyzeJob(owner, job, false);
      return json({ id: jobId }, 201);
    }

    if (kind === 'jobs' && id) {
      const job = s.jobs.find(j => j.id === id);
      if (!job) throw new AppError('岗位不存在', 404);
      if (req.method === 'GET' && !action) return json({ ...job, scorecard: job.scorecard });
      if (req.method === 'DELETE' && !action) {
        s.jobs = s.jobs.filter(x => x.id !== id);
        s.candidates = s.candidates.filter(x => x.job_id !== id);
        return json({ ok: true });
      }
      if (req.method === 'PUT' && !action) {
        const body: any = await readJson(req);
        const input = jobInput.parse(body);
        job.name = input.name; job.jd = input.jd; job.department = input.department; job.location = input.location; job.level = input.level; job.notes = input.notes;
        job.profile = { summary: '岗位画像生成中…', responsibilities: [], keywords: [] };
        job.version += 1; job.confirmed = 0; job.scorecard = null; job.generation_status = 'waiting'; job.generation_error = null; job.updated = Date.now();
        void analyzeJob(owner, job, body.reanalyze === true);
        return json({ ok: true }, 202);
      }
      if (action === 'retry' && req.method === 'POST') {
        if (job.generation_status !== 'failed') return json({ ok: true }, 202);
        job.generation_status = 'waiting'; job.generation_error = null; job.updated = Date.now();
        void analyzeJob(owner, job, false);
        return json({ ok: true }, 202);
      }
      if (action === 'scorecard' && req.method === 'PUT') {
        const body: any = await readJson(req);
        const card = cardSchema.parse(body.scorecard);
        if (job.generation_status !== 'completed' || !job.scorecard) throw new AppError('请等待岗位评分卡生成完成');
        if (!Number.isInteger(body.version) || body.version !== job.version) throw new AppError('评分卡已被更新，请刷新后再修改', 409);
        job.scorecard = card; job.version += 1; job.confirmed = 1; job.updated = Date.now();
        if (body.reanalyze === true) {
          for (const c of s.candidates.filter(x => x.job_id === id)) {
            c.status = 'scoring'; c.result = null; c.score = null; c.error = null; c.error_code = null;
            c.analysis_completed_at = null; c.version = job.version; c.updated = Date.now();
            void analyzeCandidate(owner, c);
          }
        }
        return json({ version: job.version });
      }
      if (action === 'candidates' && req.method === 'GET') {
        const rows = s.candidates.filter(c => c.job_id === id).slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.created - a.created);
        return json(rows.map(publicCandidate));
      }
      if (action === 'metrics' && req.method === 'GET') {
        const rows = s.candidates.filter(c => c.job_id === id);
        const completed = rows.filter(c => c.status === 'completed');
        const failed = rows.filter(c => c.status === 'failed');
        const spans = completed.map(c => (c.analysis_completed_at ?? 0) - (c.analysis_started_at ?? 0)).filter(x => x > 0);
        return json({
          counts: { uploaded: rows.length, completed: completed.length, failed: failed.length, average_ms: spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : 0 },
          usage: { requests: rows.length, average_tokens: null, total_estimated_cost: null, average_estimated_cost: null },
          review: null,
        });
      }
      if (action === 'ranking' && req.method === 'POST') {
        const body: any = await readJson(req);
        const ids: string[] = Array.isArray(body.candidateIds) ? body.candidateIds : [];
        if (!ids.length || ids.length > 200 || ids.some(x => typeof x !== 'string') || new Set(ids).size !== ids.length) throw new AppError('请选择不重复的人工排序候选人');
        const ai = s.candidates.filter(c => c.job_id === id && c.status === 'completed').sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.created - b.created).map(c => c.id);
        if (ids.some(x => !ai.includes(x))) throw new AppError('只能比较当前岗位、当前版本已完成分析的候选人');
        const overlap = (k: number) => { const n = Math.min(k, ai.length, ids.length); return n ? ids.slice(0, n).filter(x => ai.slice(0, n).includes(x)).length / n : 0; };
        return json({ top5_overlap: overlap(5), top10_overlap: overlap(10), sample_size: Math.min(ai.length, ids.length) });
      }
    }

    if (kind === 'candidates' && !id && req.method === 'POST') {
      const fd = await req.formData();
      const file = fd.get('file');
      const jobId = String(fd.get('jobId') || '');
      if (!(file instanceof File)) throw new AppError('缺少简历文件');
      const job = s.jobs.find(j => j.id === jobId);
      if (!job) throw new AppError('岗位不存在', 404);
      if (!job.confirmed || !job.scorecard) throw new AppError('请先确认并保存评分卡，再上传简历。', 409);
      checkFile(file);
      const bytes = await file.arrayBuffer();
      const text = await parseDocument(bytes, file.name);
      const name = file.name.replace(/\.(pdf|docx)$/i, '').split(/[-_]/)[0].trim() || '未命名';
      const created: LocalCandidate = {
        id: 'cand-' + crypto.randomUUID().slice(0, 8), job_id: jobId, owner, name, filename: file.name,
        status: 'scoring', score: null, version: job.version, error: null, error_code: null, retry_count: 0,
        created: Date.now(), updated: Date.now(), analysis_started_at: Date.now(), analysis_completed_at: null,
        mime: /\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        resume_text: text, model: effectiveModel(owner, 'resume'), prompt_version: PROMPT_VERSION, result: null,
        file_bytes: new Uint8Array(bytes),
      };
      s.candidates.unshift(created);
      void analyzeCandidate(owner, created);
      return json({ id: created.id, status: 'scoring' }, 202);
    }

    if (kind === 'candidates' && id) {
      const c = s.candidates.find(x => x.id === id);
      if (!c) throw new AppError('候选人不存在', 404);
      if (req.method === 'DELETE' && !action) {
        s.candidates = s.candidates.filter(x => x.id !== id);
        return json({ ok: true });
      }
      if (action === 'retry' && req.method === 'POST') {
        if (c.status !== 'failed') return json({ ok: true }, 202);
        c.status = 'scoring'; c.error = null; c.error_code = null; c.result = null; c.score = null;
        c.analysis_completed_at = null; c.retry_count += 1; c.updated = Date.now();
        void analyzeCandidate(owner, c);
        return json({ ok: true }, 202);
      }
      if (action === 'file' && req.method === 'GET') {
        if (!c.file_bytes) return json({ error: '原始文件不可用' }, 404);
        const disposition = c.mime === 'application/pdf' ? 'inline' : 'attachment';
        return new Response(c.file_bytes as any, {
          headers: {
            'Content-Type': c.mime,
            'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(c.filename)}`,
            'Cache-Control': 'private, no-store',
          },
        });
      }
      if (req.method === 'GET' && !action) {
        const job = s.jobs.find(j => j.id === c.job_id);
        return json({ ...publicCandidate(c), scorecard: job?.scorecard ?? null, profile: job?.profile ?? null, result: c.result });
      }
    }

    return json({ error: '接口不存在' }, 404);
  } catch (e) {
    if (e instanceof ZodError) return json({ error: e.issues.map(x => x.message).join('；') }, 400);
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    console.error('local-ai request failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return json({ error: '本地真实模式发生错误' }, 500);
  }
}
