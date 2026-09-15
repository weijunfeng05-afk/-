import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {initializeLocal,collectEnv,readiness,allowedKeys} from '../scripts/deployment-env.mjs';
test('cloud login metadata and local credentials cannot be staged accidentally',()=>{
 const root=existsSync('../netlify.toml')?'..':'.';
 const files=['.env.local','.netlify/state.json','supabase/.temp/linked-project.json','xiaofeng-resume/supabase/.temp/pooler-url'];
 const ignored=execFileSync('git',['check-ignore','--stdin'],{cwd:root,input:files.join('\n'),encoding:'utf8'}).trim().split(/\r?\n/);
 assert.deepEqual(ignored,files);
});
test('env initialization never replaces an existing secret file',()=>{
 const root=mkdtempSync(join(tmpdir(),'resume-env-'));try{const path=join(root,'.env.local');writeFileSync(path,'DEEPSEEK_API_KEY=synthetic-existing\n');assert.equal(initializeLocal(path,'DEEPSEEK_API_KEY=\n'),false);assert.match(readFileSync(path,'utf8'),/synthetic-existing/)}finally{rmSync(root,{recursive:true})}
});
test('readiness reports missing keys without secret values',()=>{
 const result=readiness({DEEPSEEK_API_KEY:'synthetic-private'});assert.equal(result.ready,false);assert.ok(result.missing.includes('DATABASE_URL'));assert.ok(!JSON.stringify(result).includes('synthetic-private'));
});
test('configuration conflicts fail closed and legacy anon-key alias is supported',()=>{
 const root=mkdtempSync(join(tmpdir(),'resume-env-'));try{const a=join(root,'a'),b=join(root,'b');writeFileSync(a,'DEEPSEEK_API_KEY=secret-one\nNEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-anon\n');writeFileSync(b,'DEEPSEEK_API_KEY=secret-two\n');assert.throws(()=>collectEnv([a,b]),e=>e.message==='Conflicting configuration: DEEPSEEK_API_KEY');assert.equal(collectEnv([a]).NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,'synthetic-anon')}finally{rmSync(root,{recursive:true})}
});
test('root deploy config points to Next application and removes static SPA fallback',()=>{
 const monorepo=existsSync('../netlify.toml');const config=readFileSync(monorepo?'../netlify.toml':'netlify.toml','utf8');if(monorepo)assert.match(config,/base = "xiaofeng-resume"/);assert.match(config,/publish = "\.next"/);assert.ok(!config.includes('/index.html'));assert.ok(!config.includes('frontend'));
 const ignore=readFileSync(monorepo?'../.gitignore':'.gitignore','utf8');assert.ok(ignore.includes('.env*')||ignore.includes('.env.*'));assert.equal(new Set(allowedKeys).size,allowedKeys.length);
});
