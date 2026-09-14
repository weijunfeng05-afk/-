import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
export const owner='11111111-1111-4111-8111-111111111111';
export async function fixture(){
 const d=new PGlite();
 await d.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;
 grant usage on schema auth,storage,public to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id serial primary key,bucket_id text,name text);
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 insert into auth.users(id) values('${owner}');`);
 for(const name of ['001_multiuser.sql','002_beta.sql','003_recovery.sql','004_workflows.sql','005_job_tasks.sql','006_hardening.sql','007_dispatch.sql','008_edit_job.sql','009_atomic_completion.sql'])await d.exec(readFileSync('supabase/migrations/'+name,'utf8'));
 const asUser=fn=>d.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:owner})]);await tx.exec('set local role app_backend');return fn(tx)});
 const placeholders=s=>{let n=0;return s.replace(/'(?:''|[^'])*'|\?/g,x=>x==='?'?'$'+ ++n:x)};
 const execute=async(tx,s)=>{const r=await tx.query(placeholders(s.sql),s.args);return {results:r.rows,meta:{changes:r.affectedRows??r.rows.length}}};
 const binding={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){return (await asUser(tx=>execute(tx,this))).results[0]||null},async run(){return asUser(tx=>execute(tx,this))},async all(){return this.run()}}},async batch(statements){return asUser(async tx=>{const out=[];for(const s of statements)out.push(await execute(tx,s));return out})}};
 return {d,asUser,binding};
}
