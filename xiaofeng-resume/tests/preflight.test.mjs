import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
test('partial cloud preflight checks available credentials, skips unavailable accounts, and never logs keys',async()=>{
 await build({entryPoints:['scripts/cloud-preflight.mjs'],bundle:true,platform:'node',format:'esm',outfile:'work/preflight-fixture.mjs',plugins:[{name:'isolated-credentials',setup(b){b.onResolve({filter:/deployment-env\.mjs$/},()=>({path:'env',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'js',contents:"export const loadDeployment=()=>({DEEPSEEK_API_KEY:'synthetic-test-key'});export const readiness=()=>({ready:false,missing:['NETLIFY_AUTH_TOKEN']});"}))}}]});
 const savedFetch=globalThis.fetch,savedLog=console.log,savedExit=process.exitCode;const logs=[],requests=[];
 try{
  console.log=(line)=>logs.push(line);
  globalThis.fetch=async(url,options)=>{requests.push(url);assert.equal(options.headers.Authorization,'Bearer synthetic-test-key');return new Response(null,{status:200})};
  await import('../work/preflight-fixture.mjs');
  assert.deepEqual(requests,['https://api.deepseek.com/models']);
  assert.equal(process.exitCode,2);assert.ok(!logs.join('').includes('synthetic-test-key'));
  assert.equal(logs.map(x=>JSON.parse(x)).filter(x=>x.skipped).length,3);
 }finally{globalThis.fetch=savedFetch;console.log=savedLog;process.exitCode=savedExit}
});
