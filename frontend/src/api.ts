export async function api<T>(path:string, init:RequestInit={}):Promise<T> {
  const response = await fetch('/api'+path,{...init,headers:{...(init.body && !(init.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...init.headers}});
  if(!response.ok){let message='请求失败，请检查本机服务。';try{message=(await response.json()).message||message;}catch{/* use default */}throw new Error(message);}
  return response.json();
}
export const json = (method:string, body:unknown):RequestInit => ({method,body:JSON.stringify(body)});
