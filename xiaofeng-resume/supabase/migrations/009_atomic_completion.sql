begin;
create function complete_candidate(cid text,token text,score_value integer,result_value text,profile_value text,name_value text,stamp bigint)
returns boolean language plpgsql set search_path=public as $$
declare current_token text;
begin
 select lease into current_token from evaluations where candidate_id=cid for update;
 if current_token is distinct from token then return false; end if;
 update candidates set profile=profile_value,name=name_value where id=cid;
 update evaluations set status='completed',score=score_value,result=result_value,error=null,error_code=null,
 lease=null,analysis_completed_at=stamp,updated=stamp where candidate_id=cid;
 return true;
end $$;
revoke all on function complete_candidate(text,text,integer,text,text,text,bigint) from public;
grant execute on function complete_candidate(text,text,integer,text,text,text,bigint) to app_backend;
commit;
