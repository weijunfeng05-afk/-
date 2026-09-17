import {isAllowedRequestOrigin} from '@/lib/request-origin';
import {ensureLegacyOwnerSettings,getSettingsStatus,saveConfiguration,testConfiguration,removeConfiguration} from '@/lib/ai/settings';
import {supabaseServer} from '@/lib/supabase/server';
import {db,json,AppError,withUserRuntime,runtime} from '@/lib/db';
import {demoEnabled,demoRequest} from '@/lib/demo';
import {localAiEnabled,localAiRequest} from '@/lib/local-ai';
import {jobInput,cardSchema} from '@/lib/ai/schema';
import {checkFile,parseDocument} from '@/lib/documents';
import {dispatchSafely} from '@/lib/background';
import {candidateInput,validStoragePath} from '@/lib/beta';
import {jobMetrics,saveRanking} from '@/lib/metrics';
import {ZodError} from 'zod';
export const dynamic='force-dynamic';
async function business(req:Request,user:{userId:string;email:string}){
 try{
  const owner=user.userId;
  if(!isAllowedRequestOrigin(req))return json({error:'无效的请求来源'},403);
  const parts=new URL(req.url).pathname.slice(5).split('/');const [kind,id,action]=parts,d=db();
  const ownedJob=async(jobId:string)=>{const j:any=await d.prepare('SELECT * FROM jobs WHERE id=? AND owner=?').bind(jobId,owner).first();if(!j)throw new AppError('岗位不存在',404);return j;};
  await ensureLegacyOwnerSettings(user);
  if(kind==='status'&&req.method==='GET')return json({ai_configured:(await getSettingsStatus(owner)).configured});
  if(kind==='settings'&&id==='ai'){
    if(req.method==='GET'&&!action)return json(await getSettingsStatus(owner));
    if(req.method==='PUT'&&!action)return json(await saveConfiguration(owner,await req.json()));
    if(req.method==='POST'&&action==='test')return json(await testConfiguration(owner,await req.json()));
    if(req.method==='DELETE'&&!action)return json(await removeConfiguration(owner,await req.json()));
  }
  if(kind==='documents'&&req.method==='POST'){
   const {storagePath,fileName}=await req.json();if(typeof storagePath!=='string'||typeof fileName!=='string'||!validStoragePath(storagePath,owner,'jd'))throw new AppError('无效的文件路径');
   const client=await supabaseServer();const bucket=client.storage.from('resumes');
   try{const {data,error}=await bucket.download(storagePath);if(error||!data)throw new AppError('文件读取失败');checkFile(new File([data],fileName));return json({text:await parseDocument(await data.arrayBuffer(),fileName)})}
   finally{await bucket.remove([storagePath])}
  }
  if(kind==='jobs'&&!id&&req.method==='GET'){const rows=await d.prepare("SELECT j.*,COUNT(c.id) AS count,SUM(CASE WHEN e.score>=85 AND e.status='completed' THEN 1 ELSE 0 END) AS high,SUM(CASE WHEN e.status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN c.created>=? THEN 1 ELSE 0 END) AS today FROM jobs j LEFT JOIN candidates c ON c.job_id=j.id LEFT JOIN evaluations e ON e.candidate_id=c.id WHERE j.owner=? GROUP BY j.id ORDER BY j.updated DESC").bind(Date.now()-86400000,owner).all();return json(rows.results.map((r:any)=>({...r,profile:JSON.parse(r.profile)})));}
  if(kind==='jobs'&&!id&&req.method==='POST'){
   const input=jobInput.parse(await req.json()),jobId=crypto.randomUUID(),now=Date.now();
   await d.prepare("INSERT INTO jobs (id,owner,name,department,location,level,notes,jd,profile,version,confirmed,generation_status,created,updated) VALUES (?,?,?,?,?,?,?,?,?,1,0,'waiting',?,?)").bind(jobId,owner,input.name,input.department,input.location,input.level,input.notes,input.jd,JSON.stringify({summary:'岗位画像生成中',responsibilities:[],keywords:[]}),now,now).run();
   await dispatchSafely(jobId,'job');
   return json({id:jobId},201);
  }
  if(kind==='jobs'&&id){const job=await ownedJob(id);
   if(req.method==='DELETE'&&!action){
    const files=await d.prepare('SELECT file_key FROM candidates WHERE job_id=?').bind(id).all();
    await d.batch([d.prepare('DELETE FROM evaluations WHERE candidate_id IN (SELECT id FROM candidates WHERE job_id=?)').bind(id),d.prepare('DELETE FROM candidates WHERE job_id=?').bind(id),d.prepare('DELETE FROM scorecards WHERE job_id=?').bind(id),d.prepare('DELETE FROM ranking_reviews WHERE job_id=?').bind(id),d.prepare('DELETE FROM jobs WHERE id=? AND owner=?').bind(id,owner)]);
    for(const row of files.results as unknown as {file_key:string}[]){try{await runtime().BUCKET.delete(row.file_key)}catch{/* 忽略单个原文件清理失败 */}}
    return json({ok:true});
   }
   if(req.method==='PUT'&&!action){const body=await req.json();const input=jobInput.parse(body);if(!Number.isInteger(body.version))throw new AppError('缺少岗位版本');await d.prepare('SELECT revise_job(?,?,?,?,?)').bind(id,body.version,JSON.stringify(input),body.reanalyze===true,Date.now()).run();await dispatchSafely(id,'job');return json({ok:true},202);}
   if(action==='metrics'&&req.method==='GET')return json(await jobMetrics(id));
   if(action==='ranking'&&req.method==='POST'){const body=await req.json();return json(await saveRanking(id,body.version,body.candidateIds));}
   if(req.method==='GET'&&!action){const card:any=await d.prepare('SELECT * FROM scorecards WHERE job_id=? AND version=?').bind(id,job.version).first();return json({...job,profile:JSON.parse(job.profile),scorecard:card?JSON.parse(card.data):null});}
   if(action==='retry'&&req.method==='POST'){await d.prepare("UPDATE jobs SET generation_status='waiting',generation_retries=generation_retries+1,updated=? WHERE id=? AND generation_status='failed'").bind(Date.now(),id).run();await dispatchSafely(id,'job');return json({ok:true},202);}
   if(action==='scorecard'&&req.method==='PUT'){
    if(job.generation_status!=='completed')throw new AppError('请等待岗位评分卡生成完成');
    const body:any=await req.json(),card=cardSchema.parse(body.scorecard);if(!Number.isInteger(body.version)||body.version!==job.version)throw new AppError('评分卡已被更新，请刷新后再修改',409);
    const row:any=await d.prepare('SELECT replace_scorecard(?,?,?,?,?) AS version').bind(id,body.version,JSON.stringify(card),body.reanalyze===true,Date.now()).first();
    return json({version:row.version});
   }
   if(action==='candidates'&&req.method==='GET'){
    const rows=await d.prepare('SELECT c.id,c.name,c.filename,c.created,e.status,e.score,e.version,e.error,e.result,e.retry_count,e.error_code,e.analysis_started_at,e.analysis_completed_at,e.updated FROM candidates c JOIN evaluations e ON e.candidate_id=c.id WHERE c.job_id=? ORDER BY e.score DESC NULLS LAST,c.created DESC').bind(id).all();return json(rows.results.map((r:any)=>({...r,result:r.result?JSON.parse(r.result):null})));
   }
  }
  if(kind==='candidates'&&!id&&req.method==='POST'){
   const input=candidateInput.parse(await req.json());await ownedJob(input.jobId);
   if(!validStoragePath(input.storagePath,owner,input.jobId))throw new AppError('无效的文件路径');
   const expectedMime=/\.pdf$/i.test(input.fileName)?'application/pdf':/\.docx$/i.test(input.fileName)?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'';
   if(!expectedMime||!input.storagePath.endsWith(input.fileName.toLowerCase().endsWith('.pdf')?'.pdf':'.docx'))throw new AppError('文件格式不匹配');
   const client=await supabaseServer();const {data:info,error}=await client.storage.from('resumes').info(input.storagePath);
   if(error||!info||!info.size||info.size>10485760||info.contentType!==expectedMime)throw new AppError('文件不存在、格式无效或超过 10 MB');
   const row:any=await d.prepare('SELECT enqueue_candidate(?,?,?,?,?,?) AS id').bind(crypto.randomUUID(),input.jobId,input.storagePath,input.fileName,expectedMime,Date.now()).first();
   await dispatchSafely(row.id);return json({id:row.id,status:'waiting'},202);
  }
  if(kind==='usage'&&req.method==='GET')return json(await d.prepare('SELECT * FROM beta_usage WHERE owner=?').bind(owner).first());

  if(kind==='candidates'&&id){const c:any=await d.prepare('SELECT c.*,e.status,e.score,e.version,e.result,e.error,e.scorecard_id,e.retry_count,e.error_code,e.analysis_started_at,e.analysis_completed_at,e.model,e.prompt_version,e.updated FROM candidates c JOIN jobs j ON j.id=c.job_id JOIN evaluations e ON e.candidate_id=c.id WHERE c.id=? AND j.owner=?').bind(id,owner).first();if(!c)throw new AppError('候选人不存在',404);
   if(req.method==='DELETE'&&!action){
    await d.batch([d.prepare('DELETE FROM evaluations WHERE candidate_id=?').bind(id),d.prepare('DELETE FROM candidates WHERE id=?').bind(id)]);
    if(c.file_key){try{await runtime().BUCKET.delete(c.file_key)}catch{/* 原文件清理失败不影响数据删除 */}}
    return json({ok:true});
   }
   if(action==='retry'&&req.method==='POST'){await d.prepare("UPDATE evaluations SET status='waiting',retry_count=retry_count+1,error=NULL,error_code=NULL,score=NULL,result=NULL,lease=NULL,updated=? WHERE candidate_id=? AND status='failed'").bind(Date.now(),id).run();await dispatchSafely(id);return json({ok:true},202);}
   if(action==='file'&&req.method==='GET'){const client=await supabaseServer();const {data,error}=await client.storage.from('resumes').createSignedUrl(c.file_key,60);if(error)throw new AppError('文件暂时不可用',503);return Response.redirect(data.signedUrl,302);}
   if(req.method==='GET'&&!action){const card:any=await d.prepare('SELECT data FROM scorecards WHERE id=?').bind(c.scorecard_id).first();return json({...c,file_key:undefined,result:c.result?JSON.parse(c.result):null,profile:c.profile?JSON.parse(c.profile):null,scorecard:card?JSON.parse(card.data):null});}
  }
  return json({error:'接口不存在'},404);
 }catch(e){if(e instanceof ZodError)return json({error:e.issues.map(x=>x.message).join('；')},400);if(e instanceof Error&&/内测额度|评分卡已|请先确认/.test(e.message))return json({error:e.message},409);if(e instanceof AppError)return json({error:e.message},e.status);console.error('API request failed',e instanceof Error?e.name:'unknown');return json({error:'服务暂时不可用，请稍后重试；已保存的数据不会丢失。'},503);}
}
async function handler(req:Request){
  // 本地真实 AI 模式：真实调用 DeepSeek，数据保存在内存，不连接 Supabase / 数据库。
  if(localAiEnabled())return localAiRequest(req);
  // 本地演示模式：返回内置示例数据，不连接 Supabase 与数据库。
  if(demoEnabled())return demoRequest(req);
 try{
  const client=await supabaseServer();
  const {data:{user},error}=await client.auth.getUser();
  if(error||!user)return json({error:'请先登录工作空间'},401);
  return await withUserRuntime(user.id,client,()=>business(req,{userId:user.id,email:user.email||''}));
 }catch{return json({error:'服务暂时不可用，请稍后重试。'},503);}
}
export const GET=handler;export const POST=handler;export const PUT=handler;export const DELETE=handler;
