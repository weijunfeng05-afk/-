-- Run once on a NEW Supabase project, using the SQL editor.
begin;
create table public.jobs (
 id text primary key, owner uuid not null references auth.users(id), name text not null,
 department text not null default '', location text not null default '', level text not null default '',
 notes text not null default '', jd text not null, profile text not null,
 version integer not null default 1, confirmed integer not null default 0,
 created bigint not null, updated bigint not null
);
create index jobs_owner_updated on public.jobs(owner,updated);
create table public.scorecards (
 id text primary key, job_id text not null references public.jobs(id), version integer not null,
 data text not null, created bigint not null, unique(job_id,version)
);
create table public.candidates (
 id text primary key, job_id text not null references public.jobs(id), name text not null,
 filename text not null, file_key text not null, mime text not null,
 resume_text text, profile text, created bigint not null
);
create index candidates_job_created on public.candidates(job_id,created);
create table public.evaluations (
 id text primary key, candidate_id text not null unique references public.candidates(id),
 scorecard_id text not null references public.scorecards(id), version integer not null,
 status text not null, score integer, result text, error text, lease text,
 updated bigint not null, created bigint not null
);
create index evaluation_status on public.evaluations(status);
create table public.ai_calls (
 id text primary key, owner uuid not null references auth.users(id), subject text not null,
 task text not null, model text not null, attempt integer not null, latency integer not null,
 input_tokens integer, output_tokens integer, estimated_cost double precision,
 json_valid integer not null, success integer not null, created bigint not null
);
create index calls_owner_created on public.ai_calls(owner,created);
create table public.api_settings (
 owner uuid primary key references auth.users(id), encrypted_key text, key_suffix text,
 job_model text not null default 'deepseek-v4-pro', resume_model text not null default 'deepseek-v4-flash',
 version integer not null default 1, updated bigint not null
);

alter table public.jobs enable row level security;
alter table public.scorecards enable row level security;
alter table public.candidates enable row level security;
alter table public.evaluations enable row level security;
alter table public.ai_calls enable row level security;
alter table public.api_settings enable row level security;
alter table public.jobs force row level security;
alter table public.scorecards force row level security;
alter table public.candidates force row level security;
alter table public.evaluations force row level security;
alter table public.ai_calls force row level security;
alter table public.api_settings force row level security;

revoke all on public.jobs,public.scorecards,public.candidates,public.evaluations,public.ai_calls,public.api_settings from anon;
grant select,insert,update,delete on public.jobs,public.scorecards,public.candidates,public.evaluations,public.ai_calls,public.api_settings to authenticated;
create policy jobs_owner on public.jobs to authenticated
 using(owner=(select auth.uid())) with check(owner=(select auth.uid()));
create policy calls_owner on public.ai_calls to authenticated
 using(owner=(select auth.uid())) with check(owner=(select auth.uid()));
create policy settings_owner on public.api_settings to authenticated
 using(owner=(select auth.uid())) with check(owner=(select auth.uid()));
create policy cards_owner on public.scorecards to authenticated
 using(exists(select 1 from public.jobs j where j.id=job_id and j.owner=(select auth.uid())))
 with check(exists(select 1 from public.jobs j where j.id=job_id and j.owner=(select auth.uid())));
create policy candidates_owner on public.candidates to authenticated
 using(exists(select 1 from public.jobs j where j.id=job_id and j.owner=(select auth.uid())))
 with check(exists(select 1 from public.jobs j where j.id=job_id and j.owner=(select auth.uid()))
   and split_part(file_key,'/',1)=(select auth.uid())::text);
create policy evaluations_owner on public.evaluations to authenticated
 using(exists(select 1 from public.candidates c join public.jobs j on j.id=c.job_id
   where c.id=candidate_id and j.owner=(select auth.uid())))
 with check(exists(select 1 from public.candidates c join public.jobs j on j.id=c.job_id
   join public.scorecards s on s.job_id=c.job_id where c.id=candidate_id and s.id=scorecard_id and j.owner=(select auth.uid())));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('resumes','resumes',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
create policy resume_read on storage.objects for select to authenticated
 using(bucket_id='resumes' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy resume_insert on storage.objects for insert to authenticated
 with check(bucket_id='resumes' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy resume_delete on storage.objects for delete to authenticated
 using(bucket_id='resumes' and (storage.foldername(name))[1]=(select auth.uid())::text);
commit;
