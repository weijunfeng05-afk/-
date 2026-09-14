import {z} from 'zod';
export const candidateInput=z.object({jobId:z.string().uuid(),storagePath:z.string().max(512),fileName:z.string().min(1).max(200)}).strict();
export function validStoragePath(path:string,owner:string,jobId:string){
 const parts=path.split('/');return parts.length===3&&parts[0]===owner&&parts[1]===jobId&&/^[a-f0-9-]{36}\.(pdf|docx)$/.test(parts[2]);
}
export function overlap(ai:string[],human:string[],k:number){
 const size=Math.min(k,ai.length,human.length);if(!size)return null;
 return human.slice(0,size).filter(id=>ai.slice(0,size).includes(id)).length/size;
}
export const isRunning=(status:string)=>['waiting','parsing','scoring'].includes(status);
