begin;
-- Slots survive scorecard replacement: obsolete in-flight requests still count
-- toward the same owner's limit until they finish or their bounded lease expires.
create table analysis_slots(token text primary key,owner uuid not null references auth.users(id),expires bigint not null);
alter table analysis_slots enable row level security;
grant select,insert,delete on analysis_slots to app_backend;
create policy slots_owner on analysis_slots to app_backend using(owner=auth.uid()) with check(owner=auth.uid());
create or replace function claim_candidate(cid text,token text,stamp bigint) returns setof evaluations
language plpgsql set search_path=public as $$
declare jid text;
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select c.job_id into jid from candidates c join jobs j on j.id=c.job_id join evaluations e on e.candidate_id=c.id where c.id=cid and j.confirmed=1 and e.version=j.version;
 if jid is null then return; end if;
 perform 1 from jobs where id=jid for update;
 delete from analysis_slots where expires<stamp;
 if (select count(*) from analysis_slots)>=3 then return; end if;
 if not exists(select 1 from evaluations e join jobs j on j.id=jid where e.candidate_id=cid and e.status='waiting' and j.confirmed=1 and e.version=j.version) then return; end if;
 insert into analysis_slots values(token,auth.uid(),stamp+300000);
 return query update evaluations set status='parsing',lease=token,error=null,error_code=null,
 analysis_started_at=stamp,analysis_completed_at=null,updated=stamp where candidate_id=cid and status='waiting' returning *;
end $$;
create or replace function claim_job(jid text,token text,stamp bigint) returns setof jobs language plpgsql set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 delete from analysis_slots where expires<stamp;
 if (select count(*) from analysis_slots)>=3 then return; end if;
 if not exists(select 1 from jobs where id=jid and generation_status='waiting') then return; end if;
 insert into analysis_slots values(token,auth.uid(),stamp+300000);
 return query update jobs set generation_status='scoring',generation_lease=token,generation_error=null,updated=stamp
 where id=jid and generation_status='waiting' returning *;
end $$;
-- Storage quota applies even when a client bypasses the candidate API.
create function may_upload_resume() returns boolean language sql security definer set search_path=public as $$
 select auth.uid() is not null and
 (select count(*) from storage.objects where bucket_id='resumes' and split_part(name,'/',1)=auth.uid()::text)
 < coalesce((select candidate_limit from beta_usage where owner=auth.uid()),200)
$$;
revoke all on function may_upload_resume() from public;
grant execute on function may_upload_resume() to authenticated;
drop policy resume_insert on storage.objects;
create policy resume_insert on storage.objects for insert to authenticated with check(
 bucket_id='resumes' and (storage.foldername(name))[1]=auth.uid()::text and may_upload_resume());
alter table ai_calls add column job_id text;
alter table ai_calls add column candidate_id text;
alter table ai_calls add column error_code text;
alter table ai_calls add column status text;
alter table ai_calls add column cost_currency text not null default 'USD';
commit;
