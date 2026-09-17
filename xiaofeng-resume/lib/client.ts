// 统一的服务端调用入口。
// 注意：服务端异常时可能返回 HTML 错误页或空响应，直接解析 JSON 会抛出难懂的错误，
// 因此先判断 content-type，并为非 JSON 响应提供可读的兜底提示。
export async function api(path:string,options?:RequestInit){
  const response=await fetch('/api/'+path,options);
  const contentType=response.headers.get('content-type')||'';
  const body:any=contentType.includes('application/json')?await response.json().catch(()=>({})):{};
  if(!response.ok){
    const fallback=response.status===401?'登录状态已失效，请重新登录。':response.status===403?'没有权限执行该操作。':`请求失败（${response.status}），请稍后重试。`;
    throw Error(body.error||fallback);
  }
  return body;
}
export function send(data:unknown,method='POST'){return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}}
export const levelLabels:Record<string,string>={high:'高优先级',recommended:'建议查看',review:'需要人工判断',low:'低优先级'};
export const statuses:Record<string,string>={waiting:'等待分析',parsing:'解析中',scoring:'评分中',completed:'已完成',failed:'分析失败'};
