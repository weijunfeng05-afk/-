begin;
-- Browser clients can read their data, but only the trusted server can mutate it.
create role app_backend nologin inherit;
grant authenticated to app_backend;
grant app_backend to postgres;
revoke insert,update,delete on public.jobs,public.scorecards,public.candidates,public.evaluations,public.ai_calls,public.api_settings from authenticated;
grant insert,update,delete on public.jobs,public.scorecards,public.candidates,public.evaluations,public.ai_calls,public.api_settings to app_backend;

alter table evaluations add column retry_count integer not null default 0;
alter table evaluations add column error_code text;
alter table evaluations add column analysis_started_at bigint;
alter table evaluations add column analysis_completed_at bigint;
alter table evaluations add column model text;
alter table evaluations add column prompt_version text;
alter table evaluations add constraint valid_status check(status in ('waiting','parsing','scoring','completed','failed'));
create unique index candidate_storage_key on candidates(file_key);

create table beta_invites(id uuid primary key default gen_random_uuid(),code text unique not null,
 email text not null,used boolean not null default false,used_by uuid,expires_at timestamptz not null,
 created_at timestamptz not null default now());
alter table beta_invites enable row level security;
revoke all on beta_invites from public,anon,authenticated;
-- Atomic invitation redemption in the Auth insert transaction. Direct Auth API
-- registration is subject to the same check as the application form.
create function enforce_beta_invite() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update beta_invites set used=true,used_by=new.id where code=new.raw_user_meta_data->>'beta_invite'
 and lower(email)=lower(new.email) and not used and expires_at>now();
 if not found then raise exception '当前产品处于封闭内测阶段，请使用有效的邮箱专属邀请码'; end if;
 return new;
end $$;
revoke all on function enforce_beta_invite() from public;
create trigger beta_registration before insert on auth.users for each row execute function enforce_beta_invite();

create table beta_usage(owner uuid primary key references auth.users(id),jobs integer not null default 0,
 candidates integer not null default 0,ai_requests integer not null default 0,
 job_limit integer not null default 10,candidate_limit integer not null default 200,ai_limit integer not null default 1000);
insert into beta_usage(owner,jobs,candidates) select u.id,(select count(*) from jobs j where j.owner=u.id),
 (select count(*) from candidates c join jobs j on j.id=c.job_id where j.owner=u.id) from auth.users u;
alter table beta_usage enable row level security;
grant select on beta_usage to authenticated;
create policy usage_owner on beta_usage to authenticated using(owner=auth.uid());
create function reserve_beta_quota(kind text) returns void language plpgsql security definer set search_path=public as $$
declare u uuid=auth.uid();
begin
 if u is null then raise exception 'Authentication required'; end if;
 insert into beta_usage(owner) values(u) on conflict do nothing;
 if kind='job' then update beta_usage set jobs=jobs+1 where owner=u and jobs<job_limit;
 elsif kind='candidate' then update beta_usage set candidates=candidates+1 where owner=u and candidates<candidate_limit;
 elsif kind='ai' then update beta_usage set ai_requests=ai_requests+1 where owner=u and ai_requests<ai_limit;
 else raise exception 'Invalid quota'; end if;
 if not found then raise exception '当前内测额度已用完'; end if;
end $$;
revoke all on function reserve_beta_quota(text) from public;
grant execute on function reserve_beta_quota(text) to app_backend;
create function enforce_resource_quota() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform reserve_beta_quota(case when tg_table_name='jobs' then 'job' else 'candidate' end);
 return new;
end $$;
revoke all on function enforce_resource_quota() from public;
create trigger jobs_quota before insert on jobs for each row execute function enforce_resource_quota();
create trigger candidates_quota before insert on candidates for each row execute function enforce_resource_quota();

-- The owner lock serializes claims across all function instances. Leases are
-- longer than the bounded single AI call; the scheduler recovers expired claims.
create function claim_candidate(cid text,token text,stamp bigint) returns setof evaluations
language plpgsql set search_path=public as $$
declare jid text;
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select c.job_id into jid from candidates c where c.id=cid;
 perform 1 from jobs where id=jid for update;
 if (select count(*) from jobs where generation_status='scoring' and updated>stamp-300000)+(select count(*) from evaluations e join candidates c on c.id=e.candidate_id join jobs j on j.id=c.job_id
     where j.owner=auth.uid() and e.status in ('parsing','scoring') and e.updated>stamp-300000)>=3 then return; end if;
 return query update evaluations set status='parsing',lease=token,error=null,error_code=null,
 analysis_started_at=stamp,analysis_completed_at=null,updated=stamp
 where candidate_id=cid and status='waiting' returning *;
end $$;
revoke all on function claim_candidate(text,text,bigint) from public;
grant execute on function claim_candidate(text,text,bigint) to app_backend;

create table ranking_reviews(job_id text primary key references jobs(id),version integer not null,
 candidate_ids jsonb not null,ai_candidate_ids jsonb not null,top5_overlap double precision,top10_overlap double precision,
 created bigint not null);
alter table ranking_reviews enable row level security;
grant select on ranking_reviews to authenticated;
grant insert,update on ranking_reviews to app_backend;
create policy review_owner on ranking_reviews to authenticated using(exists(select 1 from jobs where id=job_id and owner=auth.uid()))
 with check(exists(select 1 from jobs where id=job_id and owner=auth.uid()));
commit;
