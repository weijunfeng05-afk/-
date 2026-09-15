import {loadDeployment,readiness} from './deployment-env.mjs';
// Read-only checks. No migration, secret rotation or cloud resource mutation.
const env=loadDeployment(),state=readiness(env);
console.log(JSON.stringify({stage:'configuration',...state},null,2));
const checks=[
 ['netlify',env.NETLIFY_SITE_ID&&env.NETLIFY_AUTH_TOKEN,'https://api.netlify.com/api/v1/sites/'+encodeURIComponent(env.NETLIFY_SITE_ID||''),{Authorization:'Bearer '+env.NETLIFY_AUTH_TOKEN}],
 ['supabase',env.SUPABASE_PROJECT_REF&&env.SUPABASE_ACCESS_TOKEN,'https://api.supabase.com/v1/projects/'+encodeURIComponent(env.SUPABASE_PROJECT_REF||''),{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN}],
 ['supabase-auth',env.NEXT_PUBLIC_SUPABASE_URL&&env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,(env.NEXT_PUBLIC_SUPABASE_URL||'').replace(/\/$/,'')+'/auth/v1/settings',{apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}],
 ['deepseek',env.DEEPSEEK_API_KEY,'https://api.deepseek.com/models',{Authorization:'Bearer '+env.DEEPSEEK_API_KEY}]
];
let failed=false;
for(const [service,configured,url,headers] of checks){
 if(!configured){console.log(JSON.stringify({service,skipped:true,reason:'MISSING_CONFIGURATION'}));continue}
 try{const response=await fetch(url,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});console.log(JSON.stringify({service,status:response.status,ok:response.ok}));if(!response.ok)failed=true}catch{failed=true;console.log(JSON.stringify({service,ok:false,error:'CONNECTION_FAILED'}))}
}
process.exitCode=failed?1:state.ready?0:2;
