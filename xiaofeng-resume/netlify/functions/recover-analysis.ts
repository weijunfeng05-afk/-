import {serviceClient,dispatch} from '../../lib/background';
export default async function handler(){
 const client=serviceClient(),now=Date.now();
 for(const name of ['recover_candidates','recover_jobs']){const {error}=await client.rpc(name,{stamp:now});if(error)throw Error('Queue recovery failed')}
 const {data,error}=await client.rpc('ready_tasks',{stamp:now});if(error)throw Error('Queue lookup failed');
 const tasks=(data||[]) as {id:string;kind:'candidate'|'job'}[];
 const results=await Promise.allSettled(tasks.map(task=>dispatch(task.id,task.kind)));
 if(results.some(r=>r.status==='rejected'))throw Error('Some background dispatches failed');
}
export const config={schedule:'* * * * *'};
