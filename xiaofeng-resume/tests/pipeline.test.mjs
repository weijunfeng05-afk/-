import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture,owner} from './fixture.mjs';
const {d,asUser,binding}=await fixture();after(()=>d.close());
globalThis.__aiFixtureEnv={DB:binding,DEEPSEEK_API_KEY:'test-only-not-a-real-key'};
await build({entryPoints:['lib/processing.ts','lib/job-processing.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outdir:'work/pipeline',plugins:[{name:'test-runtime',setup(b){b.onResolve({filter:/^(?:\.\/db|@\/lib\/db)$/},()=>({path:'runtime',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const runtime=()=>globalThis.__aiFixtureEnv; export const db=()=>runtime().DB; export class AppError extends Error { constructor(message,status=400){super(message);this.status=status;} }',loader:'js'}));}}]});
const {processJob}=await import('../work/pipeline/job-processing.js');
const {processCandidate}=await import('../work/pipeline/processing.js');
const card={dimensions:[{id:'d1',name:'项目经验',weight:100,rubric:'按主导深度与实际成果评分'}],must_have:['Agent 项目'],nice_to_have:[]};
const text='主导 Agent 工作流设计，完成知识库产品上线，服务 1000 位用户。';
await asUser(async tx=>{
 await tx.query("insert into jobs(id,owner,name,jd,profile,confirmed,created,updated) values('job',$1,'岗位','jd',$2,1,1,1)",[owner,JSON.stringify({summary:'产品',responsibilities:[],keywords:[]})]);
 await tx.query("insert into scorecards values('card','job',1,$1,1)",[JSON.stringify(card)]);
});
async function seed(id){await asUser(async tx=>{
 await tx.query("select enqueue_candidate($1,'job',$2,'a.pdf','application/pdf',1)",[id,owner+'/job/'+id]);
 await tx.query('update candidates set resume_text=$1 where id=$2',[text,id]);
})}
const output=()=>({candidate_profile:{name:'匿名候选人',education:[],experience:[],projects:[],skills:[],achievements:[]},dimension_scores:[{id:'d1',score:86,evidence:['主导 Agent 工作流设计'],reason:'有主导证据'}],strengths:['具备项目经历'],risks:[],must_have:[{requirement:'Agent 项目',status:'met',evidence:'主导 Agent 工作流设计'}],confidence:.8});
const success=content=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:100,completion_tokens:50,prompt_cache_hit_tokens:20}});
const row=async id=>(await d.query('select * from evaluations where candidate_id=$1',[id])).rows[0];
test('后台完整评分、版本、token日志与重复投递幂等',async()=>{
 await seed('success');let calls=0;globalThis.fetch=async()=>{calls++;return success(output())};
 await processCandidate('success',owner);await processCandidate('success',owner);
 assert.equal(calls,1);const r=await row('success');assert.equal(r.status,'completed');assert.equal(r.score,86);assert.equal(r.prompt_version,'resume-analysis-v1.1');assert.equal(r.model,'deepseek-flash');assert.ok(r.analysis_completed_at);
 const log=(await d.query("select * from ai_calls where subject='success'")).rows[0];assert.equal(log.input_tokens,100);assert.equal(log.output_tokens,50);
});
test('一次任务只调用一次AI，定时恢复最多自动重试2次',async()=>{
 await seed('retry');let calls=0;globalThis.fetch=async()=>{calls++;return new Response('',{status:429})};
 for(let i=0;i<3;i++){await processCandidate('retry',owner);assert.equal(calls,i+1);await d.query('select recover_candidates($1)',[Date.now()+60000]);}
 const r=await row('retry');assert.equal(r.status,'failed');assert.equal(r.retry_count,2);assert.equal(r.score,null);assert.equal(r.result,null);
});
test('重复上传路径只创建一条记录且只占用一次额度',async()=>{
 const before=(await d.query('select candidates from beta_usage')).rows[0].candidates;
 await seed('same');await asUser(tx=>tx.query("select enqueue_candidate('ignored','job',$1,'a.pdf','application/pdf',1)",[owner+'/job/same']));
 assert.equal((await d.query('select candidates from beta_usage')).rows[0].candidates,before+1);
});
test('每用户最多三个运行任务，第四个继续等待',async()=>{
 for(const id of ['a','b','c','d'])await seed(id);
 for(const id of ['a','b','c'])assert.equal((await asUser(tx=>tx.query('select * from claim_candidate($1,$2,$3)',[id,id,Date.now()]))).rows.length,1);
 assert.equal((await asUser(tx=>tx.query('select * from claim_candidate($1,$2,$3)',['d','d',Date.now()]))).rows.length,0);
 await d.exec("delete from analysis_slots;update evaluations set status='completed',lease=null where candidate_id in ('a','b','c','d','same')");
});
test('锁定评分卡必须明确确认；旧worker结果不能污染新版本',async()=>{
 await seed('stale');let release;const gate=new Promise(r=>release=r);let entered;const started=new Promise(r=>entered=r);
 globalThis.fetch=async()=>{entered();await gate;return success(output())};
 const processing=processCandidate('stale',owner);await started;
 await assert.rejects(asUser(tx=>tx.query("select replace_scorecard('job',1,$1,false,2)",[JSON.stringify(card)])),/锁定/);
 await asUser(tx=>tx.query("select replace_scorecard('job',1,$1,true,2)",[JSON.stringify(card)]));
 assert.equal((await d.query('select count(*) n from analysis_slots')).rows[0].n,1);
 release();await processing;assert.equal((await d.query('select count(*) n from analysis_slots')).rows[0].n,0);const r=await row('stale');assert.equal(r.status,'waiting');assert.equal(r.version,2);assert.equal(r.score,null);assert.equal(r.result,null);
 assert.equal((await d.query("select name from candidates where id='stale'")).rows[0].name,'a.pdf');
});

test('岗位生成也在后台执行并记录模型用量，重复投递不重复生成',async()=>{
 await asUser(tx=>tx.query("insert into jobs(id,owner,name,jd,profile,generation_status,created,updated) values('generated',$1,'产品','JD','{}','waiting',1,1)",[owner]));
 let calls=0;globalThis.fetch=async(_url,init)=>{calls++;assert.equal(JSON.parse(init.body).model,'deepseek-v4-pro');return success({profile:{summary:'产品岗位',responsibilities:[],keywords:[]},scorecard:card})};
 await processJob('generated',owner);await processJob('generated',owner);assert.equal(calls,1);
 assert.equal((await d.query("select generation_status from jobs where id='generated'")).rows[0].generation_status,'completed');
 assert.equal((await d.query("select count(*) n from scorecards where job_id='generated'")).rows[0].n,1);
});
