import {AsyncLocalStorage} from 'node:async_hooks';
import type {SupabaseClient} from '@supabase/supabase-js';
import {postgresDatabase} from './postgres';
function storage(client:SupabaseClient){
  const bucket=client.storage.from('resumes');
  return {
    async put(key:string,body:ArrayBuffer,options:{httpMetadata:{contentType:string}}){const {error}=await bucket.upload(key,body,{contentType:options.httpMetadata.contentType,upsert:false});if(error)throw error;},
    async get(key:string){const {data,error}=await bucket.download(key);if(error)throw error;if(!data)return null;return {body:data.stream(),arrayBuffer:()=>data.arrayBuffer()};},
    async delete(key:string){const {error}=await bucket.remove([key]);if(error)throw error;},
  };
}
export type Runtime={DB:ReturnType<typeof postgresDatabase>;BUCKET:ReturnType<typeof storage>;API_KEY_ENCRYPTION_SECRET?:string;DEEPSEEK_API_KEY?:string;DEFAULT_AI_OWNER_EMAIL?:string;DEEPSEEK_JOB_MODEL?:string;DEEPSEEK_RESUME_MODEL?:string};
const context=new AsyncLocalStorage<Runtime>();
export function withUserRuntime<T>(owner:string,client:SupabaseClient,action:()=>T):T {
  return context.run({DB:postgresDatabase(owner),BUCKET:storage(client),API_KEY_ENCRYPTION_SECRET:process.env.API_KEY_ENCRYPTION_SECRET,DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY},action);
}
export function runtime(){const value=context.getStore();if(!value)throw Error('Authenticated request context required');return value;}
export function db(){return runtime().DB;}
export const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'private, no-store' },
});
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
