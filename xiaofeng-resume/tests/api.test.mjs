import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture,owner} from './fixture.mjs';
const {d,asUser,binding}=await fixture();after(()=>d.close());
const jobId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',candidateId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
globalThis.__fixture={binding,user:{id:owner,email:'hr@example.test'},dispatches:[],storageReads:0};
const client={auth:{getUser:async()=>({data:{user:globalThis.__fixture.user},error:null})},storage:{from:()=>({info:async()=>({data:{size:10485760,contentType:'application/pdf'},error:null})})}};
globalThis.__fixture.client=client;
const card={dimensions:[{id:'d1',name:'项目',weight:100,rubric:'证据'}],must_have:[],nice_to_have:[]};
await asUser(async tx=>{
 await tx.query('insert into jobs(id,owner,name,jd,profile,confirmed,created,updated) values($1,$2,\'岗位\',\'JD\',\'{}\',1,1,1)',[jobId,owner]);
 await tx.query('insert into scorecards values($1,$2,1,$3,1)',[candidateId,jobId,JSON.stringify(card)]);
});
await build({entryPoints:['app/api/[...path]/route.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'work/test-api.mjs',plugins:[{name:'runtime',setup(b){
 b.onResolve({filter:/^@\/lib\/(db|supabase\/server|background)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('/db')?`export const db=()=>globalThis.__fixture.binding;export const runtime=()=>({});export const withUserRuntime=(_owner,_client,fn)=>fn();export const json=(body,status=200)=>Response.json(body,{status});export class AppError extends Error{constructor(message,status=400){super(message);this.status=status}}`:a.path.endsWith('/background')?`export const dispatchSafely=async(id,kind='candidate')=>{globalThis.__fixture.dispatches.push({id,kind})}`:`export const supabaseServer=async()=>globalThis.__fixture.client;` }));
}}]});
const {POST,PUT,GET}=await import('../work/test-api.mjs');
const request=(path,body,method='POST')=>new Request('https://example.test/api/'+path,{method,headers:{'Content-Type':'application/json',origin:'https://example.test'},body:body===undefined?undefined:JSON.stringify(body)});
test('10MB文件仅检查Storage元数据，立即创建waiting并投递ID',async()=>{
 const body={jobId,storagePath:owner+'/'+jobId+'/'+candidateId+'.pdf',fileName:'简历.pdf'};
 let r=await POST(request('candidates',body));assert.equal(r.status,202);const first=await r.json();
 r=await POST(request('candidates',body));assert.equal((await r.json()).id,first.id);
 assert.equal((await d.query('select count(*) n from candidates')).rows[0].n,1);
 assert.equal(globalThis.__fixture.dispatches.length,2);assert.equal((await d.query('select status from evaluations')).rows[0].status,'waiting');
});
test('元数据接口拒绝跨用户路径及未登录请求',async()=>{
 let r=await POST(request('candidates',{jobId,storagePath:'other/'+jobId+'/'+candidateId+'.pdf',fileName:'a.pdf'}));assert.equal(r.status,400);
 globalThis.__fixture.user=null;r=await GET(request('jobs',undefined,'GET'));assert.equal(r.status,401);globalThis.__fixture.user={id:owner,email:'hr@example.test'};
});
test('超额岗位创建被拒绝，不投递AI任务',async()=>{
 await d.exec('update beta_usage set job_limit=jobs');const n=globalThis.__fixture.dispatches.length;
 const r=await POST(request('jobs',{name:'新岗位',jd:'这是一个满足最小长度要求的产品经理岗位描述，负责产品规划与完整生命周期管理。'}));assert.equal(r.status,409);assert.equal(globalThis.__fixture.dispatches.length,n);
});
test('已有候选人改评分卡需确认，随后全部重排且版本冲突拒绝',async()=>{
 let r=await PUT(request('jobs/'+jobId+'/scorecard',{version:1,scorecard:card},'PUT'));assert.equal(r.status,409);
 r=await PUT(request('jobs/'+jobId+'/scorecard',{version:1,scorecard:card,reanalyze:true},'PUT'));assert.equal(r.status,200);assert.equal((await r.json()).version,2);
 r=await PUT(request('jobs/'+jobId+'/scorecard',{version:1,scorecard:card,reanalyze:true},'PUT'));assert.equal(r.status,409);
});
test('修改JD暂停候选人领取，等待新评分卡生成和人工确认',async()=>{
 const r=await PUT(request('jobs/'+jobId,{version:2,reanalyze:true,name:'新岗位',jd:'这是一个足够长的修改后的岗位描述，负责用户研究、产品规划、跨部门协调和业务落地。'},'PUT'));assert.equal(r.status,202);
 const c=(await d.query('select id from candidates')).rows[0];assert.equal((await asUser(tx=>tx.query('select * from claim_candidate($1,\'token\',$2)',[c.id,Date.now()]))).rows.length,0);
 assert.equal((await d.query('select generation_status from jobs')).rows[0].generation_status,'waiting');
});
test('Netlify 的正式 Origin 能测试密钥，跨站 Origin 被拒绝且旧 Flash 名称兼容',async()=>{
 const oldSite=process.env.SITE_URL, oldFetch=globalThis.fetch, calls=[];
 process.env.SITE_URL='https://product.example.test';
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');
  calls.push(JSON.parse(options.body).model);
  return Response.json({choices:[{message:{content:'{"ok":true}'}}]});
 };
 const make=origin=>new Request('http://netlify-internal/api/settings/ai/test',{
  method:'POST',headers:{'Content-Type':'application/json',origin},
  body:JSON.stringify({api_key:'sk-synthetic-test-only-123456',job_model:'deepseek-v4-pro',resume_model:'deepseek-v4-flash',version:0})
 });
 try{
  const ok=await POST(make('https://product.example.test'));
  assert.equal(ok.status,200);
  assert.deepEqual(calls.sort(),['deepseek-flash','deepseek-v4-pro']);
  const blocked=await POST(make('https://evil.example.test'));
  assert.equal(blocked.status,403);
  assert.equal((await blocked.json()).error,'无效的请求来源');
  assert.equal(calls.length,2);
 }finally{
  globalThis.fetch=oldFetch;
  if(oldSite===undefined)delete process.env.SITE_URL;else process.env.SITE_URL=oldSite;
 }
});
