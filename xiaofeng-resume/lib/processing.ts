import {db,runtime,AppError} from './db';
import {parseDocument} from './documents';
import {callAI} from './ai/client';
import {getAiConfiguration} from './ai/settings';
import {cardSchema,validateEvaluation} from './ai/schema';
import {resumePrompt,PROMPT_VERSION} from './ai/prompts';
export async function processCandidate(id:string,owner:string){
 const d=db(),token=crypto.randomUUID();
 const claim=await d.prepare('SELECT * FROM claim_candidate(?,?,?)').bind(id,token,Date.now()).first();
 if(!claim)return;
 try{
  const row:any=await d.prepare('SELECT c.*,e.id AS evaluation_id,e.scorecard_id,j.profile AS job_profile FROM candidates c JOIN jobs j ON j.id=c.job_id JOIN evaluations e ON e.candidate_id=c.id WHERE c.id=? AND j.owner=? AND e.lease=?').bind(id,owner,token).first();
  if(!row)return;
  let text=row.resume_text;
  if(!text){const object=await runtime().BUCKET.get(row.file_key);if(!object)throw new AppError('原始文件暂时无法读取，请重试',502);text=await parseDocument(await object.arrayBuffer(),row.filename);await d.prepare('UPDATE candidates SET resume_text=? WHERE id=?').bind(text,id).run();}
  const raw:any=await d.prepare('SELECT data FROM scorecards WHERE id=?').bind(row.scorecard_id).first();const card=cardSchema.parse(JSON.parse(raw.data));
  const model=(await getAiConfiguration(owner)).resumeModel;
  const changed=await d.prepare("UPDATE evaluations SET status='scoring',model=?,prompt_version=?,updated=? WHERE id=? AND lease=?").bind(model,PROMPT_VERSION,Date.now(),row.evaluation_id,token).run();
  if(!changed.meta.changes)return;
  const result=await callAI('resume',id,owner,resumePrompt(card),{job_profile:JSON.parse(row.job_profile),resume:text},x=>validateEvaluation(x,card,text));
  await d.prepare('SELECT complete_candidate(?,?,?,?,?,?,?)').bind(id,token,result.total_score,JSON.stringify(result),JSON.stringify(result.candidate_profile),result.candidate_profile.name||row.name,Date.now()).run();
 }catch(error){
  const terminal=error instanceof AppError && error.status<500;
  await d.prepare("UPDATE evaluations SET status='failed',score=NULL,result=NULL,error=?,error_code=?,lease=NULL,analysis_completed_at=?,updated=? WHERE candidate_id=? AND lease=?")
   .bind(error instanceof AppError?error.message:'分析未完成，原始简历已保留。',terminal?'INPUT_OR_QUOTA':'TRANSIENT',Date.now(),Date.now(),id,token).run();
 }finally{await d.prepare('DELETE FROM analysis_slots WHERE token=?').bind(token).run()}
}
