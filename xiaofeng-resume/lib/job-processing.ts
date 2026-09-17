import {db,AppError} from './db';
import {callAI} from './ai/client';
import {JOB_PROMPT} from './ai/prompts';
import {parseJobOutput} from './ai/schema';
export async function processJob(id:string,owner:string){
 const d=db(),token=crypto.randomUUID();
 const job:any=await d.prepare('SELECT * FROM claim_job(?,?,?)').bind(id,token,Date.now()).first();
 if(!job)return;
 try{
  const result=await callAI('job',id,owner,JOB_PROMPT,{name:job.name,jd:job.jd,department:job.department,location:job.location,level:job.level,notes:job.notes},x=>parseJobOutput(x));
  await d.batch([
   d.prepare('INSERT INTO scorecards(id,job_id,version,data,created) SELECT ?,id,version,?,? FROM jobs WHERE id=? AND generation_lease=? ON CONFLICT(job_id,version) DO NOTHING').bind(crypto.randomUUID(),JSON.stringify(result.scorecard),Date.now(),id,token),
   d.prepare("UPDATE jobs SET profile=?,generation_status='completed',generation_lease=NULL,generation_error=NULL,updated=? WHERE id=? AND generation_lease=?").bind(JSON.stringify(result.profile),Date.now(),id,token)
  ]);
 }catch(e){await d.prepare("UPDATE jobs SET generation_status='failed',generation_lease=NULL,generation_error=?,generation_error_code=?,updated=? WHERE id=? AND generation_lease=?").bind(e instanceof AppError?e.message:'岗位分析未完成，请重试',e instanceof AppError&&e.status<500?'INPUT_OR_QUOTA':'TRANSIENT',Date.now(),id,token).run()}finally{await d.prepare('DELETE FROM analysis_slots WHERE token=?').bind(token).run()}
}
