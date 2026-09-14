'use client';
import {useEffect,useState} from 'react';
import {api} from '@/lib/client';
export default function BetaUsage(){
 const [usage,setUsage]=useState<{jobs:number;job_limit:number;candidates:number;candidate_limit:number;ai_requests:number;ai_limit:number}|null>(null);
 useEffect(()=>{api('usage').then(setUsage).catch(()=>{})},[]);
 return usage?<p className="notice">内测额度：岗位 {usage.jobs}/{usage.job_limit} · 简历 {usage.candidates}/{usage.candidate_limit} · AI 请求 {usage.ai_requests}/{usage.ai_limit}（包括重试和重新评分）</p>:null;
}
