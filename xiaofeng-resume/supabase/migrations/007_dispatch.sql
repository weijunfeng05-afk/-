begin;
alter table jobs add column generation_error_code text;
create or replace function recover_jobs(stamp bigint) returns void language plpgsql security definer set search_path=public as $$
begin
 update jobs set generation_status=case when generation_retries<2 then 'waiting' else 'failed' end,
 generation_retries=least(generation_retries+1,2),generation_lease=null,
 generation_error_code=case when generation_retries<2 then 'AUTO_RETRY' else 'RETRY_EXHAUSTED' end,
 generation_error='岗位分析中断或服务暂时不可用，请稍后重试',updated=stamp
 where (generation_status='scoring' and updated<stamp-300000)
 or (generation_status='failed' and generation_error_code='TRANSIENT' and generation_retries<2 and updated<stamp-30000);
end $$;
create function ready_tasks(stamp bigint) returns table(kind text,id text) language sql security definer set search_path=public as $$
 with pending as (
 select 'candidate'::text kind,c.id,j.owner,e.updated from candidates c join jobs j on j.id=c.job_id join evaluations e on e.candidate_id=c.id where e.status='waiting' and j.confirmed=1 and e.version=j.version
 union all select 'job',id,owner,updated from jobs where generation_status='waiting'
 ), ranked as (
 select *,row_number() over(partition by owner order by updated,id) rn from pending
 ) select r.kind,r.id from ranked r where rn<=3-(select count(*) from analysis_slots s where s.owner=r.owner and s.expires>=stamp)
 order by r.updated,r.id limit 60
$$;
revoke all on function ready_tasks(bigint) from public;
grant execute on function ready_tasks(bigint) to service_role;
grant select on jobs,candidates,evaluations to service_role;
commit;
