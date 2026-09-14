import {serviceClient,authorizedBackground} from '../../lib/background';
import {withUserRuntime} from '../../lib/db';
import {processCandidate} from '../../lib/processing';
export default async function handler(req:Request){
 if(!authorizedBackground(req))return new Response(null,{status:401});
 const {candidateId}=await req.json();
 if(typeof candidateId!=='string'||candidateId.length>100)return new Response(null,{status:400});
 const client=serviceClient();
 const {data,error}=await client.from('candidates').select('job_id,jobs!inner(owner)').eq('id',candidateId).single();
 if(error||!data)throw Error('Candidate lookup failed');
 const owner=(data.jobs as unknown as {owner:string}).owner;
 await withUserRuntime(owner,client,()=>processCandidate(candidateId,owner));
}
export const config={background:true};
