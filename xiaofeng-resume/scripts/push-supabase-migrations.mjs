#!/usr/bin/env node
// 用 Supabase Management API 按顺序执行 supabase/migrations/*.sql，并在最后做一次结构校验。
//
// 用法：
//   node scripts/push-supabase-migrations.mjs            # 读取 .env.setup.local 里的令牌
//   node scripts/push-supabase-migrations.mjs --list     # 只列出账号下的项目，不做任何修改
//
// 设计说明：
// - 全部走 Node 的 fetch，SQL 以 UTF-8 JSON 发送，避免 PowerShell / curl 造成中文乱码。
// - 严格按文件名顺序执行；任一迁移失败立即停止，不会继续往下跑。
// - 不做重复执行保护（迁移脚本本身不可重复执行），重复跑会报 already exists 之类错误。

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const API = 'https://api.supabase.com/v1';

const MIGRATIONS = [
  '001_multiuser.sql',
  '002_beta.sql',
  '003_recovery.sql',
  '004_workflows.sql',
  '005_job_tasks.sql',
  '006_hardening.sql',
  '007_dispatch.sql',
  '008_edit_job.sql',
  '009_atomic_completion.sql',
  '010_delete_cascade.sql',
  '011_open_signup.sql',
];

/** 极简 .env 解析：只取第一层 KEY=value，忽略注释。 */
function readEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (value) out[m[1]] = value;
  }
  return out;
}

const local = readEnvFile('.env.setup.local');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || local.SUPABASE_ACCESS_TOKEN || '';
let REF = process.env.SUPABASE_PROJECT_REF || local.SUPABASE_PROJECT_REF || '';
const LIST_ONLY = process.argv.includes('--list');

function fail(message) {
  console.error('\n✗ ' + message);
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

if (!TOKEN) {
  fail('缺少 SUPABASE_ACCESS_TOKEN。请填入 .env.setup.local，或设置为环境变量。');
}

// ---------- 1. 确认项目 ----------
console.log('→ 读取账号下的 Supabase 项目…');
const projects = await api('/projects');
if (!projects.ok) fail(`无法读取项目列表（HTTP ${projects.status}）：${JSON.stringify(projects.body)}`);

const rows = Array.isArray(projects.body) ? projects.body : [];
if (!rows.length) fail('该令牌下没有任何 Supabase 项目，请先在控制台创建一个项目。');

console.log('\n账号下的项目：');
for (const p of rows) {
  console.log(`  ref=${p.id}  name=${p.name}  region=${p.region}  status=${p.status}`);
}

if (LIST_ONLY) {
  console.log('\n（--list 模式，未做任何修改）');
  process.exit(0);
}

if (!REF) fail('缺少 SUPABASE_PROJECT_REF。请从上面的列表里挑一个填进 .env.setup.local 后重试。');
const target = rows.find((p) => p.id === REF);
if (!target) fail(`项目 ref=${REF} 不在该令牌可见的项目列表中，请核对后重试。`);
console.log(`\n✓ 目标项目：${target.name}（ref=${REF}, region=${target.region}）`);

// ---------- 2. 按顺序执行迁移 ----------
console.log('\n→ 开始执行迁移（按文件名顺序，任一步失败即停止）\n');
for (const file of MIGRATIONS) {
  const path = join(ROOT, 'supabase', 'migrations', file);
  if (!existsSync(path)) fail(`找不到迁移文件：supabase/migrations/${file}`);
  const query = readFileSync(path, 'utf8');
  const res = await api(`/projects/${REF}/database/query`, { method: 'POST', body: JSON.stringify({ query }) });
  if (!res.ok) {
    console.error(`✗ ${file} 执行失败（HTTP ${res.status}）`);
    console.error('  返回：' + JSON.stringify(res.body));
    console.error('\n排查提示：');
    console.error('  1) 若提示已存在（already exists），说明该库已执行过迁移，请先核对库中实际状态，不要重跑。');
    console.error('  2) 若提示不能在事务块内 begin/commit，请改用手册里的 psql 降级方案。');
    process.exit(1);
  }
  console.log(`  ✓ ${file}`);
}

console.log('\n✓ 全部 11 个迁移执行完毕。');

// ---------- 3. 结构校验 ----------
console.log('\n→ 结构校验\n');
const checks = [
  ['业务表数量', `select count(*)::int as n from information_schema.tables where table_schema='public'`],
  ['存储桶', `select id, public, file_size_limit from storage.buckets where id='resumes'`],
  ['存储策略数量', `select count(*)::int as n from pg_policies where schemaname='storage' and tablename='objects'`],
  ['注册/额度触发器', `select tgname from pg_trigger where tgname in ('beta_registration','beta_usage_init') order by 1`],
  ['011 是否生效', `select (prosrc like '%invite_code is null%') as ok from pg_proc where proname='enforce_beta_invite'`],
];

let bad = 0;
for (const [label, query] of checks) {
  const res = await api(`/projects/${REF}/database/query`, { method: 'POST', body: JSON.stringify({ query }) });
  if (!res.ok) { console.log(`  ? ${label}：查询失败 HTTP ${res.status}`); bad++; continue; }
  console.log(`  · ${label}：${JSON.stringify(res.body)}`);
}

const bucket = await api(`/projects/${REF}/database/query`, {
  method: 'POST',
  body: JSON.stringify({ query: `select public, file_size_limit from storage.buckets where id='resumes'` }),
});
const bucketRow = Array.isArray(bucket.body) ? bucket.body[0] : null;
if (!bucketRow) { console.error('\n✗ 未找到 resumes 存储桶，迁移可能未完整执行。'); bad++; }
else if (bucketRow.public !== false || Number(bucketRow.file_size_limit) !== 10485760) {
  console.error('\n✗ resumes 存储桶配置不符合预期（应为私有、10MB 上限）。'); bad++;
}

console.log('\n' + (bad ? `✗ 校验有 ${bad} 项异常，请人工核对后再继续部署。` : '✓ 校验通过，可以继续配置 Auth 与 Netlify。'));
process.exit(bad ? 1 : 0);
