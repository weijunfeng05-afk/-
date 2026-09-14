"use client";
import Link from "next/link";

import BetaUsage from '@/components/beta-usage';
import { useEffect, useState } from "react";
import { ArrowUpRight, BriefcaseBusiness, ChevronRight, FileText, KeyRound, Plus, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function Home() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/jobs").then(async response => {
      if (!response.ok) throw Error("岗位暂时无法加载，请刷新重试");
      return response.json() as Promise<any[]>;
    }).then(setJobs).catch(e => setError(e.message));
  }, []);
  return <SidebarProvider><Sidebar className="brand-sidebar">
    <SidebarHeader><Link className="brand" href="/"><span className="brand-icon">锋</span><span>小锋牌简历<small>XIAOFENG RESUME</small></span></Link></SidebarHeader>
    <SidebarContent><div className="nav-caption">招聘工作空间</div><SidebarMenu>
      <SidebarMenuItem><SidebarMenuButton isActive><BriefcaseBusiness/><span>我的岗位</span></SidebarMenuButton></SidebarMenuItem>
      <SidebarMenuItem><SidebarMenuButton asChild><a href="/settings"><KeyRound/><span>API 设置</span></a></SidebarMenuButton></SidebarMenuItem>
    </SidebarMenu></SidebarContent>
    <SidebarFooter><div className="privacy"><ShieldCheck size={19}/><span>证据驱动 · 人工决策<small>AI 帮你找到值得先看的人</small></span></div><div className="account"><b>R</b><span>招聘工作台<small>个人工作空间</small></span><span className="version">V1.1 Beta</span></div></SidebarFooter>
  </Sidebar><SidebarInset><header className="topbar"><div><SidebarTrigger/>工作空间<ChevronRight size={14}/>我的岗位</div><span>RESUME SCREENING</span></header><main className="workspace">
    <div className="page-heading"><div><p className="eyebrow">YOUR HIRING WORKSPACE</p><h1>我的岗位<span className="count">{jobs.length}</span></h1><p className="muted">从岗位标准出发，把时间留给值得深入了解的人。</p></div><Button className="primary" onClick={() => location.href="/jobs/new"}><Plus size={18}/>新建岗位</Button></div>
    {error && <div role="alert" className="error">{error} <a href="/login" target="_top" style={{textDecoration:"underline",marginLeft:12}}>登录工作空间</a></div>}
    <BetaUsage/><section className="stat-grid">{[["招聘岗位",jobs.length,"当前工作空间"],["候选人",jobs.reduce((s,j)=>s+(j.count||0),0),"上传后自动分析"],["分析完成",jobs.reduce((s,j)=>s+(j.completed||0),0),"后台分析已完成"],["高优先级",jobs.reduce((s,j)=>s+(j.high||0),0),"85 分及以上，优先查看"]].map(([name,note,desc])=><div className="stat" key={name}><span>{name}</span><strong>{note}</strong><small>{desc}</small></div>)}</section>
    <div className="section-heading"><h2>全部岗位</h2><span>按最近更新排序</span></div>
    {jobs.length ? <div className="job-grid">{jobs.map(j=><a href={`/jobs/${j.id}`} className="job-card" key={j.id}><div className="job-icon"><BriefcaseBusiness size={22}/></div><h2>{j.name}</h2><p>{j.department||"未设置部门"} · {j.location||"未设置地点"}</p><div className="job-stats"><span><b>{j.count||0}</b> 位候选人</span><span><b>{j.high||0}</b> 位高优先级</span></div><footer><span>+{j.today||0} 最近 24 小时 · {new Date(j.updated).toLocaleDateString("zh-CN")}</span><ArrowUpRight size={17}/></footer></a>)}</div> : <section className="empty-workspace"><div className="empty-icon"><FileText size={30}/></div><h2>从你的第一个岗位开始</h2><p>粘贴 JD，生成并校准专属评分卡。<br/>随后上传简历，自动获得有证据的匹配评分。</p><Button className="primary" onClick={()=>location.href="/jobs/new"}><Plus size={17}/>创建第一个岗位</Button><div className="flow"><span>01 岗位画像</span><ChevronRight/><span>02 校准评分卡</span><ChevronRight/><span>03 上传与排序</span></div></section>}
    <div className="bottom-note"><ShieldCheck size={16}/>评分仅表示岗位匹配与查看优先级，最终招聘决策由你做出。</div>
  </main></SidebarInset></SidebarProvider>;
}
