// 011_open_signup.sql 的行为验证：邀请码由「必须」改为「可选」。
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';

const MIGRATIONS = [
  '001_multiuser.sql', '002_beta.sql', '003_recovery.sql', '004_workflows.sql', '005_job_tasks.sql',
  '006_hardening.sql', '007_dispatch.sql', '008_edit_job.sql', '009_atomic_completion.sql',
  '010_delete_cascade.sql', '011_open_signup.sql',
];

async function setup() {
  const d = new PGlite();
  await d.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
    grant usage on schema auth,storage,public to authenticated;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id serial primary key, bucket_id text, name text);
    create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
  `);
  for (const name of MIGRATIONS) await d.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
  return d;
}

test('全部迁移按顺序执行成功，且 011 已替换注册校验', async () => {
  const d = await setup();
  const fn = await d.query(`select prosrc from pg_proc where proname='enforce_beta_invite'`);
  assert.match(fn.rows[0].prosrc, /invite_code is null/);
  const trig = await d.query(`select tgname from pg_trigger where tgname='beta_usage_init'`);
  assert.equal(trig.rows.length, 1);
});

test('未提供邀请码时可以自助注册，并自动建立额度记录', async () => {
  const d = await setup();
  await d.exec(`insert into auth.users(id,email,raw_user_meta_data) values('11111111-1111-4111-8111-111111111111','a@example.com','{}'::jsonb)`);
  const usage = await d.query(`select owner,jobs,candidates,ai_requests,job_limit from beta_usage where owner='11111111-1111-4111-8111-111111111111'`);
  assert.equal(usage.rows.length, 1);
  assert.equal(usage.rows[0].jobs, 0);
  assert.equal(usage.rows[0].job_limit, 10);
});

test('提供有效邀请码时校验通过并标记为已使用', async () => {
  const d = await setup();
  await d.exec(`insert into beta_invites(code,email,expires_at) values('CODE123','b@example.com',now()+interval '7 days')`);
  await d.exec(`insert into auth.users(id,email,raw_user_meta_data) values('22222222-2222-4222-8222-222222222222','b@example.com','{"beta_invite":"CODE123"}'::jsonb)`);
  const row = await d.query(`select used,used_by from beta_invites where code='CODE123'`);
  assert.equal(row.rows[0].used, true);
  assert.equal(row.rows[0].used_by, '22222222-2222-4222-8222-222222222222');
});

test('邀请码无效、过期或与邮箱不匹配时注册被拒绝', async () => {
  const d = await setup();
  await d.exec(`insert into beta_invites(code,email,expires_at) values('EXPIRED','c@example.com',now()-interval '1 day')`);
  await d.exec(`insert into beta_invites(code,email,expires_at) values('OTHER','d@example.com',now()+interval '7 days')`);
  const cases = [
    ['c@example.com', 'EXPIRED', '过期邀请码'],
    ['c@example.com', 'NOSUCH', '不存在的邀请码'],
    ['c@example.com', 'OTHER', '与邮箱不匹配的邀请码'],
  ];
  for (const [email, code, label] of cases) {
    await assert.rejects(
      d.exec(`insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'${email}','{"beta_invite":"${code}"}'::jsonb)`),
      /邀请码无效/,
      label,
    );
  }
  const used = await d.query(`select count(*)::int as n from beta_usage`);
  assert.equal(used.rows[0].n, 0, '被拒绝的注册不应留下额度记录');
});
