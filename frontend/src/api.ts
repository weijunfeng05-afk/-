export const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/,'');
export const cloudMode = !!apiBase;
export const accessHeaders = ():Record<string,string> => cloudMode ? {Authorization:'Bearer '+(sessionStorage.getItem('resume-access-token')||'')} : {};
export async function api<T>(path:string, init:RequestInit={}):Promise<T> {
  const response = await fetch(apiBase+'/api'+path,{...init,headers:{...(init.body && !(init.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...accessHeaders(),...init.headers}});
  if(!response.ok){let message='请求失败，请检查本机服务。';try{message=(await response.json()).message||message;}catch{/* use default */}throw new Error(message);}
  return response.json();
}
export const json = (method:string, body:unknown):RequestInit => ({method,body:JSON.stringify(body)});

export async function downloadResume(id:string, filename:string) {
  const response=await fetch(apiBase+'/api/resumes/'+id+'/file',{headers:accessHeaders()});
  if(!response.ok)throw new Error('原文件下载失败，请检查访问权限。');
  const url=URL.createObjectURL(await response.blob());
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
