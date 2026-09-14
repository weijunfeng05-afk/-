begin;
create function revise_job(jid text,expected integer,input jsonb,reanalyze boolean,stamp bigint) returns integer
language plpgsql set search_path=public as $$
declare j jobs;
begin
 select * into j from jobs where id=jid for update;
 if j.id is null or j.version<>expected then raise exception '评分卡已更新，请刷新' using errcode='40001'; end if;
 if exists(select 1 from candidates where job_id=jid) and not reanalyze then raise exception '评分卡已锁定，请确认重新分析全部候选人' using errcode='40001'; end if;
 update jobs set name=input->>'name',jd=input->>'jd',department=input->>'department',location=input->>'location',
 level=input->>'level',notes=input->>'notes',version=version+1,confirmed=0,generation_status='waiting',
 generation_lease=null,generation_error=null,generation_error_code=null,generation_retries=0,updated=stamp where id=jid;
 update evaluations set status='waiting',score=null,result=null,lease=null,error=null,error_code=null,updated=stamp
 where candidate_id in(select id from candidates where job_id=jid);
 return expected+1;
end $$;
revoke all on function revise_job(text,integer,jsonb,boolean,bigint) from public;
grant execute on function revise_job(text,integer,jsonb,boolean,bigint) to app_backend;
commit;
