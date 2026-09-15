import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';

export const runtimeKeys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','DEEPSEEK_API_KEY','API_KEY_ENCRYPTION_SECRET','BACKGROUND_SECRET','SITE_URL'];
export const connectionKeys=['NETLIFY_AUTH_TOKEN','NETLIFY_SITE_ID','SUPABASE_ACCESS_TOKEN','SUPABASE_PROJECT_REF'];
export const allowedKeys=[...runtimeKeys,...connectionKeys];
export function findRepoRoot(appRoot){
 const parent=resolve(appRoot,'..');
 const config=resolve(parent,'netlify.toml');
 return existsSync(config)&&/base\s*=\s*"xiaofeng-resume"/.test(readFileSync(config,'utf8'))?parent:appRoot;
}
export function collectEnv(files,environment={}){
 const values={};
 for(const file of files){
  if(!existsSync(file))continue;
  const parsed=parseEnv(readFileSync(file,'utf8'));
  if(!parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY&&parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY)parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  for(const key of allowedKeys){if(!parsed[key])continue;if(values[key]&&values[key]!==parsed[key])throw Error('Conflicting configuration: '+key);values[key]=parsed[key]}
 }
 for(const key of allowedKeys){if(!environment[key])continue;if(values[key]&&values[key]!==environment[key])throw Error('Conflicting configuration: '+key);values[key]=environment[key]}
 return values;
}
export function initializeLocal(file,example){
 if(existsSync(file))return false;
 writeFileSync(file,example,{flag:'wx',mode:0o600});return true;
}
export function readiness(values){
 const missing=allowedKeys.filter(key=>!values[key]);
 const invalid=[];
 for(const key of ['NEXT_PUBLIC_SUPABASE_URL','SITE_URL'])if(values[key]){try{if(new URL(values[key]).protocol!=='https:')invalid.push(key)}catch{invalid.push(key)}}
 if(values.DATABASE_URL){try{if(!['postgres:','postgresql:'].includes(new URL(values.DATABASE_URL).protocol))invalid.push('DATABASE_URL')}catch{invalid.push('DATABASE_URL')}}
 if(values.API_KEY_ENCRYPTION_SECRET&&Buffer.from(values.API_KEY_ENCRYPTION_SECRET,'base64').length!==32)invalid.push('API_KEY_ENCRYPTION_SECRET');
 if(values.BACKGROUND_SECRET&&values.BACKGROUND_SECRET.length<32)invalid.push('BACKGROUND_SECRET');
 return {ready:missing.length===0&&invalid.length===0,missing,invalid,configured:allowedKeys.filter(key=>!!values[key])};
}
export function loadDeployment(){
 const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repoRoot=findRepoRoot(appRoot);
 return collectEnv([resolve(repoRoot,'.env.local'),resolve(appRoot,'.env.local')],process.env);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repoRoot=findRepoRoot(appRoot);
 if(process.argv.includes('--init')){
  initializeLocal(resolve(repoRoot,'.env.local'),readFileSync(resolve(repoRoot,'.env.example'),'utf8'));
  initializeLocal(resolve(appRoot,'.env.local'),readFileSync(resolve(appRoot,'.env.example'),'utf8'));
 }
 try{const result=readiness(loadDeployment());console.log(JSON.stringify(result,null,2));if(!result.ready)process.exitCode=2}catch{console.error('Configuration conflict or unreadable local configuration; values were not logged.');process.exitCode=2}
}
