begin;
create function enqueue_candidate(cid text,jid text,path text,filename text,mime text,stamp bigint) returns text
language plpgsql set search_path=public as $$
declare j jobs; card_id text; existing text;
begin
 select * into j from jobs where id=jid for update;
 if j.id is null or j.confirmed<>1 then raise exception '请先确认评分卡'; end if;
 if split_part(path,'/',1)<>auth.uid()::text or split_part(path,'/',2)<>jid then raise exception 'Invalid file path'; end if;
 select id into existing from candidates where file_key=path;
 if existing is not null then return existing; end if;
 select id into card_id from scorecards where job_id=jid and version=j.version;
 insert into candidates(id,job_id,name,filename,file_key,mime,created) values(cid,jid,filename,filename,path,mime,stamp);
 insert into evaluations(id,candidate_id,scorecard_id,version,status,created,updated) values(gen_random_uuid()::text,cid,card_id,j.version,'waiting',stamp,stamp);
 update jobs set updated=stamp where id=jid;
 return cid;
end $$;
create function replace_scorecard(jid text,expected integer,card text,reanalyze boolean,stamp bigint) returns integer
language plpgsql set search_path=public as $$
declare j jobs; sid text=gen_random_uuid()::text;
begin
 select * into j from jobs where id=jid for update;
 if j.id is null or j.version<>expected then raise exception '评分卡已更新，请刷新' using errcode='40001'; end if;
 if exists(select 1 from candidates where job_id=jid) and not reanalyze then raise exception '评分卡已锁定，请确认重新分析全部候选人' using errcode='40001'; end if;
 insert into scorecards(id,job_id,version,data,created) values(sid,jid,expected+1,card,stamp);
 update jobs set version=expected+1,confirmed=1,updated=stamp where id=jid;
 update evaluations set scorecard_id=sid,version=expected+1,status='waiting',score=null,result=null,
 error=null,error_code=null,retry_count=0,lease=null,model=null,prompt_version=null,
 analysis_started_at=null,analysis_completed_at=null,updated=stamp
 where candidate_id in (select id from candidates where job_id=jid);
 return expected+1;
end $$;
revoke all on function enqueue_candidate(text,text,text,text,text,bigint),replace_scorecard(text,integer,text,boolean,bigint) from public;
grant execute on function enqueue_candidate(text,text,text,text,text,bigint),replace_scorecard(text,integer,text,boolean,bigint) to app_backend;
commit;
