begin;
create function recover_candidates(stamp bigint) returns void language plpgsql security definer set search_path=public as $$
begin
 update evaluations set status=case when retry_count<2 then 'waiting' else 'failed' end,
 retry_count=least(retry_count+1,2),lease=null,score=null,result=null,updated=stamp,
 error_code=case when retry_count<2 then 'AUTO_RETRY' else 'RETRY_EXHAUSTED' end,
 error='分析中断或服务暂时不可用，已保留原简历。'
 where (status in ('parsing','scoring') and updated<stamp-300000)
 or (status='failed' and error_code='TRANSIENT' and retry_count<2 and updated<stamp-30000);
end $$;
revoke all on function recover_candidates(bigint) from public;
grant execute on function recover_candidates(bigint) to service_role;
commit;
