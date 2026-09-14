begin;
alter table jobs add column generation_status text not null default 'completed' check(generation_status in ('waiting','scoring','completed','failed'));
alter table jobs add column generation_lease text;
alter table jobs add column generation_error text;
alter table jobs add column generation_retries integer not null default 0;
create function claim_job(jid text,token text,stamp bigint) returns setof jobs language plpgsql set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if (select count(*) from jobs where generation_status='scoring' and updated>stamp-300000)+
 (select count(*) from evaluations where status in ('parsing','scoring') and updated>stamp-300000)>=3 then return; end if;
 return query update jobs set generation_status='scoring',generation_lease=token,generation_error=null,updated=stamp
 where id=jid and generation_status='waiting' returning *;
end $$;
revoke all on function claim_job(text,text,bigint) from public;
grant execute on function claim_job(text,text,bigint) to app_backend;
create function recover_jobs(stamp bigint) returns void language plpgsql security definer set search_path=public as $$
begin
 update jobs set generation_status=case when generation_retries<2 then 'waiting' else 'failed' end,
 generation_retries=least(generation_retries+1,2),generation_lease=null,generation_error='岗位分析中断，请稍后重试',updated=stamp
 where generation_status='scoring' and updated<stamp-300000;
end $$;
revoke all on function recover_jobs(bigint) from public;
grant execute on function recover_jobs(bigint) to service_role;
commit;
