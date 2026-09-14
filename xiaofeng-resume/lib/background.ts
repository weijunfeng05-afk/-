import {timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
export function serviceClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Background storage credentials missing');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function dispatch(candidateId:string,kind:'candidate'|'job'='candidate'){
 const origin=process.env.URL||process.env.SITE_URL,secret=process.env.BACKGROUND_SECRET;
 if(!origin||!secret)throw Error('Background dispatch configuration missing');
 const response=await fetch(new URL(kind==='job'?'/.netlify/functions/generate-job-background':'/.netlify/functions/analyze-candidate-background',origin),{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},
  body:JSON.stringify(kind==='job'?{jobId:candidateId}:{candidateId}),signal:AbortSignal.timeout(5000),redirect:'error'});
 if(!response.ok)throw Error('Background dispatch failed');
}
export async function dispatchSafely(id:string,kind:'candidate'|'job'='candidate'){try{await dispatch(id,kind)}catch{console.warn('Background dispatch deferred to scheduler',{candidateId:id})}}

export function authorizedBackground(req:Request){
 const secret=process.env.BACKGROUND_SECRET;if(!secret)return false;
 const expected=Buffer.from('Bearer '+secret),supplied=Buffer.from(req.headers.get('authorization')||'');
 return expected.length===supplied.length&&timingSafeEqual(expected,supplied);
}
