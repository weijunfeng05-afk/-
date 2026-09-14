export async function api(path:string,options?:RequestInit){const response=await fetch('/api/'+path,options);const body:any=await response.json();if(!response.ok)throw Error(body.error||'请求失败，请重试');return body;}
export function send(data:unknown,method='POST'){return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}}
export const levelLabels:Record<string,string>={high:'高优先级',recommended:'建议查看',review:'需要人工判断',low:'低优先级'};
export const statuses:Record<string,string>={waiting:'等待分析',parsing:'解析中',scoring:'评分中',completed:'已完成',failed:'分析失败'};
