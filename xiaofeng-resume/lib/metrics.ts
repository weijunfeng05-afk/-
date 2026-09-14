import {db,AppError} from './db';
import {overlap} from './beta';
export async function jobMetrics(id:string){
 const d=db();
 const counts=await d.prepare("SELECT count(*) AS uploaded,count(*) FILTER (WHERE e.status='completed') AS completed,count(*) FILTER (WHERE e.status='failed') AS failed,avg(e.analysis_completed_at-e.analysis_started_at) FILTER (WHERE e.status='completed') AS average_ms FROM candidates c JOIN evaluations e ON e.candidate_id=c.id WHERE c.job_id=?").bind(id).first();
 const usage=await d.prepare("SELECT count(*) AS requests,avg(a.input_tokens+a.output_tokens) AS average_tokens,sum(a.estimated_cost) AS total_estimated_cost,avg(a.estimated_cost) AS average_estimated_cost FROM ai_calls a WHERE a.subject=? OR a.subject IN (SELECT id FROM candidates WHERE job_id=?)").bind(id,id).first();
 const review=await d.prepare('SELECT * FROM ranking_reviews WHERE job_id=?').bind(id).first();
 return {counts,usage,review};
}
export async function saveRanking(id:string,version:number,ids:unknown){
 if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)throw new AppError('请选择不重复的人工排序候选人');
 const d=db();
 const job:any=await d.prepare('SELECT version FROM jobs WHERE id=?').bind(id).first();
 if(job?.version!==version)throw new AppError('评分卡版本已变化，请刷新',409);
 const rows=await d.prepare("SELECT c.id FROM candidates c JOIN evaluations e ON e.candidate_id=c.id WHERE c.job_id=? AND e.version=? AND e.status='completed' ORDER BY e.score DESC,c.created DESC,c.id").bind(id,version).all();
 const ai=rows.results.map((r:any)=>r.id as string);
 if(ids.some(x=>!ai.includes(x)))throw new AppError('只能比较当前岗位、当前版本已完成分析的候选人');
 const top5=overlap(ai,ids,5),top10=overlap(ai,ids,10);
 await d.prepare('INSERT INTO ranking_reviews(job_id,version,candidate_ids,ai_candidate_ids,top5_overlap,top10_overlap,created) VALUES (?,?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET version=excluded.version,candidate_ids=excluded.candidate_ids,ai_candidate_ids=excluded.ai_candidate_ids,top5_overlap=excluded.top5_overlap,top10_overlap=excluded.top10_overlap,created=excluded.created')
  .bind(id,version,JSON.stringify(ids),JSON.stringify(ai),top5,top10,Date.now()).run();
 return {top5_overlap:top5,top10_overlap:top10,sample_size:Math.min(ai.length,ids.length)};
}
