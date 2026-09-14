import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const d=new PGlite();
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
await d.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
grant usage on schema auth,storage,public to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id serial primary key,bucket_id text,name text);
alter table storage.objects enable row level security;
grant select,insert,delete on storage.objects to authenticated;
grant usage on sequence storage.objects_id_seq to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
insert into auth.users(id) values('${a}'),('${b}');`);
await d.exec(readFileSync('supabase/migrations/001_multiuser.sql','utf8'));
for(const migration of ['002_beta.sql','003_recovery.sql','004_workflows.sql','005_job_tasks.sql','006_hardening.sql','007_dispatch.sql','008_edit_job.sql','009_atomic_completion.sql']) await d.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
async function asUser(owner,fn){return d.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:owner,role:'authenticated'})]);await tx.exec('set local role app_backend');return fn(tx);});}
test('RLS isolates every business table, writes, relationship and file path',async()=>{
 for(const owner of [a,b]) await asUser(owner,async tx=>{
  await tx.query("insert into jobs(id,owner,name,jd,profile,created,updated) values($1,$2,'job','jd','{}',1,1)",[owner,owner]);
  await tx.query("insert into scorecards values($1,$1,1,'{}',1)",[owner]);
  await tx.query("insert into candidates(id,job_id,name,filename,file_key,mime,created) values($1,$1,'name','a.pdf',$2,'application/pdf',1)",[owner,owner+'/resume']);
  await tx.query("insert into evaluations(id,candidate_id,scorecard_id,version,status,updated,created) values($1,$1,$1,1,'waiting',1,1)",[owner]);
  await tx.query("insert into api_settings(owner,updated) values($1,1)",[owner]);
  await tx.query("insert into ai_calls(id,owner,subject,task,model,attempt,latency,json_valid,success,created) values($1,$2,'x','job','test',1,0,1,1,1)",[owner,owner]);
  await tx.query("insert into storage.objects(bucket_id,name) values('resumes',$1)",[owner+'/resume']);
 });
 for(const owner of [a,b]) await asUser(owner,async tx=>{
  for(const table of ['jobs','scorecards','candidates','evaluations','api_settings','ai_calls']) {
   const {rows}=await tx.query(`select * from ${table}`);assert.equal(rows.length,1,table);assert.equal(rows[0].id||rows[0].owner,owner,table);
  }
  assert.equal((await tx.query('select * from storage.objects')).rows[0].name,owner+'/resume');
 });
 assert.equal((await asUser(a,tx=>tx.query("update jobs set name='stolen' where id=$1 returning id",[b]))).rows.length,0);
 await assert.rejects(asUser(a,tx=>tx.query("insert into jobs(id,owner,name,jd,profile,created,updated) values('bad',$1,'x','x','{}',1,1)",[b])),/row-level security/);
 await assert.rejects(asUser(a,tx=>tx.query('update jobs set owner=$1 where id=$2',[b,a])),/row-level security/);
 await assert.rejects(asUser(a,tx=>tx.query("insert into candidates(id,job_id,name,filename,file_key,mime,created) values('bad',$1,'x','x',$2,'x',1)",[b,a+'/x'])),/row-level security/);
 await assert.rejects(asUser(a,tx=>tx.query('update evaluations set scorecard_id=$1 where id=$2',[b,a])),/row-level security/);
 await assert.rejects(asUser(a,tx=>tx.query("insert into storage.objects(bucket_id,name) values('resumes',$1)",[b+'/stolen'])),/row-level security/);
 await assert.rejects(d.transaction(async tx=>{await tx.exec('set local role anon');await tx.exec('select * from jobs');}),/permission denied/);
 // A failed batch rolls back its first write as well.
 await assert.rejects(asUser(a,async tx=>{await tx.query("update jobs set name='rollback' where id=$1",[a]);await tx.query('update jobs set owner=$1 where id=$2',[b,a]);}));
 assert.equal((await asUser(a,tx=>tx.query('select name from jobs'))).rows[0].name,'job');
 await assert.rejects(d.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query('select * from ready_tasks(1)')}),/permission denied/);
 await assert.rejects(d.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query('select recover_candidates(1)')}),/permission denied/);
 // Browser users cannot forge scores or increase their quota.
 await assert.rejects(d.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:a})]);await tx.exec('set local role authenticated');await tx.exec("update evaluations set score=100");}),/permission denied/);
 await d.exec("insert into beta_invites(code,email,expires_at) values('expired','hr@example.test',now()-interval '1 day'),('wrong-email','other@example.test',now()+interval '1 day')");
 for(const code of ['expired','wrong-email'])await assert.rejects(d.query("insert into auth.users(id,email,raw_user_meta_data) values('55555555-5555-4555-8555-555555555555','hr@example.test',$1)",[JSON.stringify({beta_invite:code})]),/封闭内测/);
 // Invite validation also applies to direct Auth registration, and is atomic.
 const invited='33333333-3333-4333-8333-333333333333';
 await assert.rejects(d.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'hr@example.test','{}')",[invited]),/封闭内测/);
 await d.exec("insert into beta_invites(code,email,expires_at) values('secret-invite','hr@example.test',now()+interval '1 day')");
 await d.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'hr@example.test','{\"beta_invite\":\"secret-invite\"}')",[invited]);
 assert.equal((await d.query("select used from beta_invites where code='secret-invite'")).rows[0].used,true);
 await assert.rejects(d.exec("insert into auth.users(id,email,raw_user_meta_data) values('44444444-4444-4444-8444-444444444444','hr@example.test','{\"beta_invite\":\"secret-invite\"}')"),/封闭内测/);
 await d.close();
});
