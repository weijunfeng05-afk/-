import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/beta.ts','lib/background.ts','lib/polling.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outdir:'work/beta'});
const {validStoragePath,overlap}=await import('../work/beta/beta.js');
const {dispatch,authorizedBackground}=await import('../work/beta/background.js');
const {startTaskPolling}=await import('../work/beta/polling.js');
test('上传路径只接受当前用户当前岗位、无目录穿越',()=>{
 const name='11111111-1111-4111-8111-111111111111.pdf';
 assert.ok(validStoragePath('owner/job/'+name,'owner','job'));
 for(const path of ['other/job/'+name,'owner/other/'+name,'owner/job/../'+name,'owner/job/'+name+'/x','owner/job/a.exe'])assert.equal(validStoragePath(path,'owner','job'),false);
});
test('Top5和Top10以有效样本数为分母',()=>{
 assert.equal(overlap(['a','b','c'],['b','a','c'],10),1);
 assert.equal(overlap(['a','b','c'],['c','b'],2),.5);
 assert.equal(overlap([],[],10),null);
});
test('后台触发只传ID，内部鉴权拒绝缺失错误及Unicode伪造密钥',async()=>{
 process.env.BACKGROUND_SECRET='synthetic-secret';process.env.SITE_URL='https://example.test';delete process.env.URL;
 for(const authorization of ['', 'Bearer wrong','Bearer é'])assert.equal(authorizedBackground(new Request('https://example.test',{headers:{authorization}})),false);
 assert.equal(authorizedBackground(new Request('https://example.test',{headers:{authorization:'Bearer synthetic-secret'}})),true);
 globalThis.fetch=async(url,init)=>{assert.equal(new URL(url).pathname,'/.netlify/functions/analyze-candidate-background');assert.deepEqual(JSON.parse(init.body),{candidateId:'id'});return new Response(null,{status:202})};await dispatch('id');
 globalThis.fetch=async()=>new Response(null,{status:500});await assert.rejects(dispatch('id'));
});
test('轮询在完成、后台标签及卸载时停止，重新前台立即刷新',async()=>{
 const listeners=new Set(),timers=new Map();let seq=0,calls=0;
 const visibility={hidden:false,addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)};
 const schedule=fn=>{timers.set(++seq,fn);return seq},cancel=id=>timers.delete(id);
 const stop=startTaskPolling(async()=>{calls++},true,visibility,schedule,cancel);
 const first=[...timers.values()][0];timers.clear();await first();assert.equal(calls,1);assert.equal(timers.size,1);
 visibility.hidden=true;for(const fn of listeners)fn();assert.equal(timers.size,0);
 visibility.hidden=false;for(const fn of listeners)fn();await Promise.resolve();assert.equal(calls,2);
 stop();assert.equal(timers.size,0);assert.equal(listeners.size,0);
 const stopCompleted=startTaskPolling(async()=>{calls++},false,visibility,schedule,cancel);assert.equal(timers.size,0);
 for(const fn of listeners)fn();await Promise.resolve();assert.equal(calls,3);assert.equal(timers.size,0);stopCompleted();
});
