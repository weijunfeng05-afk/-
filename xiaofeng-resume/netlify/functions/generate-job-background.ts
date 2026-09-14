import {serviceClient,authorizedBackground} from '../../lib/background';
import {withUserRuntime} from '../../lib/db';
import {processJob} from '../../lib/job-processing';
export default async function handler(req:Request){
 if(!authorizedBackground(req))return new Response(null,{status:401});
 const {jobId}=await req.json();if(typeof jobId!=='string'||jobId.length>100)return new Response(null,{status:400});
 const client=serviceClient();const {data,error}=await client.from('jobs').select('owner').eq('id',jobId).single();
 if(error||!data)throw Error('Job lookup failed');
 await withUserRuntime(data.owner,client,()=>processJob(jobId,data.owner));
}
export const config={background:true};
