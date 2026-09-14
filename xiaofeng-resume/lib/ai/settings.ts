import { z } from 'zod';
import { AppError, db, runtime } from '@/lib/db';

export const MODELS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const;
export const settingsInput = z.object({
  api_key: z.string().trim().max(512).refine(v => !v || /^[\x21-\x7e]{16,512}$/.test(v), '密钥格式不正确，请粘贴完整密钥').optional(),
  job_model: z.enum(MODELS),
  resume_model: z.enum(MODELS),
  version: z.number().int().nonnegative(),
}).strict();
export type SettingsInput = z.infer<typeof settingsInput>;
type SettingsRow = {
  owner: string; encrypted_key: string | null; key_suffix: string | null;
  job_model: string; resume_model: string; version: number; updated: number;
};
const encoder = new TextEncoder();
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function encryptionKey() {
  try {
    const raw = decode64(runtime().API_KEY_ENCRYPTION_SECRET || '');
    if (raw.length !== 32) throw Error('invalid key');
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch { throw new AppError('密钥存储服务暂未就绪，请联系管理员。', 503); }
}
export async function encryptApiKey(plaintext: string, owner: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: encoder.encode('v1:' + owner) }, await encryptionKey(), encoder.encode(plaintext));
  return 'v1:' + base64(nonce) + ':' + base64(new Uint8Array(encrypted));
}
export async function decryptApiKey(ciphertext: string, owner: string) {
  const key = await encryptionKey();
  try {
    const [version, nonce, data] = ciphertext.split(':');
    if (version !== 'v1' || !nonce || !data) throw Error('invalid payload');
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode64(nonce), additionalData: encoder.encode('v1:' + owner) }, key, decode64(data));
    return new TextDecoder().decode(decrypted);
  } catch { throw new AppError('无法读取已保存的密钥，请重新填写 API 配置。', 503); }
}
const readRow = (owner: string) => db().prepare('SELECT * FROM api_settings WHERE owner=?').bind(owner).first<SettingsRow>();

// Only the platform-verified original owner's email can migrate the legacy secret.
// A cleared config remains as a tombstone, so it is never restored implicitly.
export async function ensureLegacyOwnerSettings(user: {userId: string; email: string}) {
  const e = runtime();
  if (!e.DEFAULT_AI_OWNER_EMAIL || !e.DEEPSEEK_API_KEY || user.email.toLowerCase() !== e.DEFAULT_AI_OWNER_EMAIL.toLowerCase()) return;
  if (await readRow(user.userId)) return;
  const ciphertext = await encryptApiKey(e.DEEPSEEK_API_KEY, user.userId);
  const job = MODELS.includes(e.DEEPSEEK_JOB_MODEL as any) ? e.DEEPSEEK_JOB_MODEL! : MODELS[0];
  const resume = MODELS.includes(e.DEEPSEEK_RESUME_MODEL as any) ? e.DEEPSEEK_RESUME_MODEL! : MODELS[1];
  await db().prepare('INSERT INTO api_settings (owner,encrypted_key,key_suffix,job_model,resume_model,version,updated) VALUES (?,?,?,?,?,1,?) ON CONFLICT(owner) DO NOTHING')
    .bind(user.userId, ciphertext, e.DEEPSEEK_API_KEY.slice(-4), job, resume, Date.now()).run();
}
export async function getSettingsStatus(owner: string) {
  const r = await readRow(owner);
  return {
    configured: !!r?.encrypted_key || !!runtime().DEEPSEEK_API_KEY,
    masked_key: r?.key_suffix ? '•••• •••• ' + r.key_suffix : null,
    job_model: r?.job_model || MODELS[0], resume_model: r?.resume_model || MODELS[1],
    version: r?.version || 0, updated_at: r?.updated || null,
    provider: 'DeepSeek', endpoint: 'https://api.deepseek.com',
  };
}
export async function getAiConfiguration(owner: string) {
  const r = await readRow(owner);
  if (!r?.encrypted_key) {if(runtime().DEEPSEEK_API_KEY)return {apiKey:runtime().DEEPSEEK_API_KEY!,jobModel:MODELS[0],resumeModel:MODELS[1]};throw new AppError('平台 AI 服务尚未配置，请联系管理员或使用自己的 API Key。',503);}
  return { apiKey: await decryptApiKey(r.encrypted_key, owner), jobModel: r.job_model, resumeModel: r.resume_model };
}
async function draftConfiguration(owner: string, input: SettingsInput) {
  const current = await readRow(owner);
  if (input.version !== (current?.version || 0)) throw new AppError('API 配置已在其他页面更新，请刷新后再试。', 409);
  const apiKey = input.api_key || (current?.encrypted_key ? await decryptApiKey(current.encrypted_key, owner) : '');
  if (!apiKey) throw new AppError('请填写 DeepSeek API Key。');
  return { apiKey, jobModel: input.job_model, resumeModel: input.resume_model };
}
async function probeModel(apiKey: string, model: string) {
  const started = Date.now();
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Return only this JSON: {"ok":true}' }], response_format: {type: 'json_object'}, thinking: {type: 'disabled'}, max_tokens: 32 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const message = response.status === 401 ? '密钥认证失败，请检查是否复制完整。'
        : response.status === 402 ? 'API 账户余额不足，请充值后重试。'
        : response.status === 429 ? 'API 请求过于频繁，请稍后重试。'
        : response.status === 404 || response.status === 400 ? '当前账户无法使用所选模型，请检查模型选择。'
        : 'API 服务暂时不可用，请稍后重试。';
      throw new AppError(message, 422);
    }
    const body: any = await response.json();
    if (JSON.parse(body.choices?.[0]?.message?.content || '').ok !== true) throw Error('invalid JSON output');
    return { model, latency_ms: Date.now() - started, ok: true };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('连接超时或返回格式不符合要求，请稍后重试。', 422);
  }
}
export async function testConfiguration(owner: string, raw: unknown) {
  const input = settingsInput.parse(raw), config = await draftConfiguration(owner, input);
  const models = [...new Set([config.jobModel, config.resumeModel])];
  return { ok: true, checks: await Promise.all(models.map(model => probeModel(config.apiKey, model))) };
}
export async function saveConfiguration(owner: string, raw: unknown) {
  const input = settingsInput.parse(raw), config = await draftConfiguration(owner, input);
  // Validate both selected models before replacing a working configuration.
  const checks = await Promise.all([...new Set([config.jobModel, config.resumeModel])].map(model => probeModel(config.apiKey, model)));
  const ciphertext = await encryptApiKey(config.apiKey, owner);
  const result = await db().prepare(`INSERT INTO api_settings (owner,encrypted_key,key_suffix,job_model,resume_model,version,updated) VALUES (?,?,?,?,?,1,?)
    ON CONFLICT(owner) DO UPDATE SET encrypted_key=excluded.encrypted_key,key_suffix=excluded.key_suffix,job_model=excluded.job_model,resume_model=excluded.resume_model,version=api_settings.version+1,updated=excluded.updated WHERE api_settings.version=?`)
    .bind(owner, ciphertext, config.apiKey.slice(-4), config.jobModel, config.resumeModel, Date.now(), input.version).run();
  if (!result.meta.changes) throw new AppError('API 配置已更新，请刷新后再试。', 409);
  return { ...await getSettingsStatus(owner), checks };
}
export async function removeConfiguration(owner: string, raw: unknown) {
  const {version} = z.object({version:z.number().int().nonnegative()}).strict().parse(raw);
  const result = await db().prepare('UPDATE api_settings SET encrypted_key=NULL,key_suffix=NULL,version=version+1,updated=? WHERE owner=? AND version=?').bind(Date.now(), owner, version).run();
  if (!result.meta.changes) throw new AppError('API 配置已更新，请刷新后再试。', 409);
  return getSettingsStatus(owner);
}
