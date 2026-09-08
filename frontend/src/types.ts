export type Condition = {id:string;text:string;kind:'must'|'bonus'};
export type Requirements = {skills:string[];experience:string[];other:string[];conditions:Condition[]};
export type Job = {id:string;name:string;jd_text:string;requirements:Requirements;confirmed:boolean;version:number;created_at:number;resume_count?:number;active_count?:number};
export type Task = {id:string;task_type:string;job_id:string;resume_id:string|null;status:string;stage:string;attempt:number;error:{message:string}|null;output:{requirements?:Requirements;job_version?:number;match_id?:string}|null};
export type Evidence = {text_block_id:string;quote:string};
export type Match = {id:string;resume_id:string;total_score:number|null;category:string;provisional:boolean;stale:boolean;summary:string;dimensions:{dimension:string;score:number|null;reason:string;evidence:Evidence[]}[];conditions:{condition_id:string;status:string;reason:string;evidence:Evidence[]}[];weights:Record<string,number>;hard_counts:Record<string,number>;job_version:number;model:string;created_at:number;input_snapshot:{requirements:Requirements};resume?:ResumeDetail};
export type Resume = {id:string;filename:string;name:string|null;created_at:number;task:Task|null;match:Match|null};
export type ResumeDetail = {id:string;filename:string;name:string|null;text_blocks:{id:string;location:string;text:string}[]|null;parsed_json:Record<string,unknown>|null};
export type ModelConfig = {base_url:string;model:string;key_set:boolean;key_mask:string;config_version:number;encryption_ready:boolean};
export const emptyRequirements = ():Requirements => ({skills:[],experience:[],other:[],conditions:[]});
export const dimensionNames:Record<string,string> = {skills:'技能匹配',experience:'经历相关性',other:'其他岗位要求',bonus:'额外加分条件'};
export const statusNames:Record<string,string> = {queued:'等待中',running:'分析中',succeeded:'已完成',failed:'分析失败',interrupted:'执行中断'};
export const activeTask = (task:Task|null) => !!task && ['queued','running'].includes(task.status);
export function sortResumes(rows:Resume[], category:string, sort:string):Resume[] {
  return rows.filter(r=>category==='全部' || (category==='分析失败' ? ['failed','interrupted'].includes(r.task?.status||'') : r.match?.category===category)).sort((a,b)=>{
    const rankable = (r:Resume) => !!r.match && !r.match.stale && !r.match.provisional && r.match.total_score!==null && !activeTask(r.task) && r.task?.status==='succeeded';
    if (rankable(a)!==rankable(b)) return rankable(a)?-1:1;
    if(sort==='newest')return b.created_at-a.created_at;
    return ((a.match?.total_score??-1)-(b.match?.total_score??-1))*(sort==='score_asc'?1:-1);
  });
}
