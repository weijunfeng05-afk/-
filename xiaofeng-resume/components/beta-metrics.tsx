'use client';
import {useEffect,useState} from 'react';
import {api,send} from '@/lib/client';
import {Button} from '@/components/ui/button';
export default function BetaMetrics({jobId,version,rows}:{jobId:string;version:number;rows:{id:string;name:string;status:string}[]}){
 const [data,setData]=useState<any>(null),[ranks,setRanks]=useState<Record<string,string>>({}),[message,setMessage]=useState('');
 useEffect(()=>{api('jobs/'+jobId+'/metrics').then(setData).catch(e=>setMessage(e.message))},[jobId,version,rows]);
 const percent=(n:number,d:number)=>d?Math.round(n/d*100)+'%':'—';
 async function save(){try{
  const chosen=Object.entries(ranks).filter(([,v])=>v).map(([id,v])=>({id,rank:Number(v)})).sort((a,b)=>a.rank-b.rank);
  if(!chosen.length||chosen.some((r,i)=>r.rank!==i+1))throw Error('人工名次需要从 1 开始连续填写，不能重复');
  const result=await api('jobs/'+jobId+'/ranking',send({version,candidateIds:chosen.map(x=>x.id)}));
  setMessage('已保存：Top5 重合率 '+Math.round(result.top5_overlap*100)+'%，Top10 重合率 '+Math.round(result.top10_overlap*100)+'%（有效样本 '+result.sample_size+' 人）');
 }catch(e){setMessage((e as Error).message)}}
 return <section className="panel"><h2>内测验证</h2>{data&&<><p>上传 {data.counts.uploaded} 份 · 完成 {data.counts.completed} 份 · 成功率 {percent(data.counts.completed,data.counts.uploaded)} · 失败率 {percent(data.counts.failed,data.counts.uploaded)}</p><p>完成任务平均耗时 {data.counts.average_ms?Math.round(data.counts.average_ms/1000)+' 秒':'—'} · 平均 Token {data.usage.average_tokens?Math.round(data.usage.average_tokens):'—'} · 估算总成本 {data.usage.total_estimated_cost==null?'未配置价格':Number(data.usage.total_estimated_cost).toFixed(4)+' USD（估算）'}</p>{data.review&&<p>已保存对比：评分卡 V{data.review.version} · Top5 {Math.round(data.review.top5_overlap*100)}% · Top10 {Math.round(data.review.top10_overlap*100)}%</p>}</>}
 <details><summary>记录 HR 人工排序，比较 Top5 / Top10</summary><p>请先独立人工查看简历，再为优先候选人填写 1、2、3…；不足 5 / 10 人时按有效样本计算。</p>{rows.filter(r=>r.status==='completed').map(r=><label style={{display:'flex',gap:16,margin:'8px 0'}} key={r.id}><span>{r.name}</span><input aria-label={r.name+'人工名次'} type="number" min={1} max={200} value={ranks[r.id]||''} onChange={e=>setRanks({...ranks,[r.id]:e.target.value})}/></label>)}<Button onClick={save}>保存人工排序</Button></details><p role="status">{message}</p></section>;
}
