import {ZodError} from 'zod';
import {db,AppError} from '@/lib/db';
import {getAiConfiguration} from './settings';
export async function callAI<T>(task:'job'|'resume',subject:string,owner:string,system:string,input:unknown,validate:(x:unknown)=>T):Promise<T>{
 const config=await getAiConfiguration(owner);
 try{await db().prepare("SELECT reserve_beta_quota('ai')").run()}catch{throw new AppError('当前内测额度已用完。',429)}
 const model=task==='job'?config.jobModel:config.resumeModel;
 let last:unknown;
 for(let attempt=0;attempt<1;attempt++){
  const start=Date.now();let usage:any;let valid=false;let success=false;let errorCode:string|null=null;
  try{
   const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',headers:{'Authorization':`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}],response_format:{type:'json_object'},thinking:{type:'disabled'},max_tokens:7000,temperature:0.1}),signal:AbortSignal.timeout(90000)});
   if(!response.ok)throw new AppError(response.status===429?'AI 服务繁忙，请稍后重试':response.status===401?'DeepSeek 服务认证失败，请检查后端密钥':`AI 服务暂时不可用 (${response.status})`,502);
   const body:any=await response.json();usage=body.usage;
   if(body.choices?.[0]?.finish_reason==='length')throw Error('AI 输出超限');
   const raw=JSON.parse(body.choices?.[0]?.message?.content||'');valid=true;
   const data=validate(raw);success=true;return data;
  }catch(error){last=error;errorCode=error instanceof ZodError?'SCHEMA':error instanceof AppError?'PROVIDER':'INVALID_OR_TIMEOUT';console.warn("AI attempt failed",{task,subject,attempt:attempt+1,kind:error instanceof ZodError?"schema_validation":error instanceof Error?error.name:"unknown",issues:error instanceof ZodError?error.issues.map(i=>({path:i.path.join("."),code:i.code})):undefined});}finally{
   const t=new Date(start),peak=t.getUTCDay()>0&&t.getUTCDay()<6&&((t.getUTCHours()>=1&&t.getUTCHours()<4)||(t.getUTCHours()>=6&&t.getUTCHours()<10));
   const multiplier=(model.includes('pro')?3:1)*(peak?1:.5);
   const cost=usage?(((usage.prompt_cache_hit_tokens||0)*.014+(usage.prompt_tokens-(usage.prompt_cache_hit_tokens||0))*.44+usage.completion_tokens*1.32)*multiplier/1e6):null;
   await db().prepare('INSERT INTO ai_calls (id,owner,subject,task,model,attempt,latency,input_tokens,output_tokens,estimated_cost,json_valid,success,created,job_id,candidate_id,error_code,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,subject,task,model,attempt+1,Date.now()-start,usage?.prompt_tokens??null,usage?.completion_tokens??null,cost,Number(valid),Number(success),start,task==='job'?subject:((await db().prepare('SELECT job_id FROM candidates WHERE id=?').bind(subject).first<{job_id:string}>())?.job_id||null),task==='resume'?subject:null,errorCode,success?'completed':'failed').run();
  }

 }
 throw last instanceof AppError?last:new AppError('AI 结果未通过校验或请求超时，请稍后重试。',502);
}
