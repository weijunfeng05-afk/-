"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";

import BetaUsage from '@/components/beta-usage';
import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, BriefcaseBusiness, ChevronRight, FileText, KeyRound, LoaderCircle, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEMO_MODE } from "@/lib/simple-auth";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

// 统一按北京时间格式化，避免服务端与浏览器时区不一致导致水合报错。
const dateText=(value:string|number)=>new Date(value).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"});

// 一次性新手引导：用 useSyncExternalStore 读取 localStorage，
// 避免在 effect 中同步 setState 引发的级联渲染，同时规避水合不一致。
const guideListeners=new Set<()=>void>();
const guideDismissed=()=>{try{return localStorage.getItem("xiaofeng-guide-dismissed")==="1"}catch{return true}};
function useGuide(){
  const dismissed=useSyncExternalStore(
    listener=>{guideListeners.add(listener);return()=>{guideListeners.delete(listener)}},
    guideDismissed,
    ()=>true,
  );
  return {visible:!dismissed,dismiss(){try{localStorage.setItem("xiaofeng-guide-dismissed","1")}catch{/* 隐私模式下忽略写入失败 */}guideListeners.forEach(listener=>listener())}};
}

export default function Home() {
  const router=useRouter();
  const [jobs, setJobs] = useState<any[]>([]);
  const [error, setError] = useState("");
  const guide = useGuide();
  // 载入内置示例数据，便于第一次上手时对照；正式环境不显示该入口。
  const [seeding, setSeeding] = useState(false);
  async function loadSample() {
    setSeeding(true); setError("");
    try {
      const created = await fetch("/api/demo-seed", { method: "POST" });
      if (!created.ok) throw Error("载入示例数据失败，请稍后重试");
      const response = await fetch("/api/jobs");
      if (!response.ok) throw Error("示例数据已载入，但列表刷新失败，请手动刷新页面");
      setJobs(await response.json());
    } catch (e) { setError((e as Error).message); } finally { setSeeding(false); }
  }
  useEffect(() => {
    fetch("/api/jobs").then(async response => {
      if (!response.ok) throw Error(response.status===401?"登录状态已失效，请重新登录后继续。":"岗位暂时无法加载，请刷新重试");
      return response.json() as Promise<any[]>;
    }).then(setJobs).catch(e => setError(e.message));
  }, []);
  return <SidebarProvider><Sidebar className="brand-sidebar" collapsible="icon">
    <SidebarHeader><Link className="brand" href="/"><span className="brand-icon">锋</span><span>小锋牌简历筛选机<small>XIAOFENG RESUME SCREENING</small></span></Link></SidebarHeader>
    <SidebarContent><div className="nav-caption">招聘工作空间</div><SidebarMenu>
      <SidebarMenuItem><SidebarMenuButton isActive><BriefcaseBusiness/><span>我的岗位</span></SidebarMenuButton></SidebarMenuItem>
      <SidebarMenuItem><SidebarMenuButton asChild><Link href="/settings"><KeyRound/><span>API 设置</span></Link></SidebarMenuButton></SidebarMenuItem>
    </SidebarMenu></SidebarContent>
    <SidebarFooter><div className="privacy"><ShieldCheck size={19}/><span>证据驱动 · 人工决策<small>AI 帮你找到值得先看的人</small></span></div><div className="account"><b>锋</b><span>招聘工作台<small>个人工作空间</small></span><span className="version">V1.1 Beta</span></div></SidebarFooter>
  </Sidebar><SidebarInset><header className="topbar"><div><SidebarTrigger/>工作空间<ChevronRight size={14}/>我的岗位</div><span>RESUME SCREENING</span></header><main className="workspace">
    <div className="page-heading"><div><p className="eyebrow">YOUR HIRING WORKSPACE</p><h1>我的岗位<span className="count">{jobs.length}</span></h1><p className="muted">从岗位标准出发，把时间留给值得深入了解的人。</p></div><Button className="primary" onClick={() => router.push("/jobs/new")}><Plus size={18}/>新建岗位</Button></div>
    {error && <div role="alert" className="error">{error}{error.includes("登录")&&<Link href="/login" style={{textDecoration:"underline",marginLeft:12}}>去登录</Link>}</div>}
    <BetaUsage/>{guide.visible&&<section className="guide"><div className="guide-icon"><Sparkles size={20}/></div><div><b>三步开始筛选</b><ol><li><b>创建岗位</b>：粘贴 JD，AI 会提取该岗位的画像并生成专属评分维度。</li><li><b>校准评分卡</b>：按你的判断调整维度与权重，确认后这套标准即锁定。</li><li><b>上传简历</b>：拖入 PDF / DOCX，自动排序，每条评分都能追溯到简历原文。</li></ol></div><button type="button" onClick={guide.dismiss}><X size={15}/>知道了</button></section>}<section className="stat-grid">{[["招聘岗位",jobs.length,"当前工作空间"],["候选人",jobs.reduce((s,j)=>s+(j.count||0),0),"上传后自动分析"],["分析完成",jobs.reduce((s,j)=>s+(j.completed||0),0),"后台分析已完成"],["高优先级",jobs.reduce((s,j)=>s+(j.high||0),0),"85 分及以上，优先查看"]].map(([name,note,desc])=><div className="stat" key={name}><span>{name}</span><strong>{note}</strong><small>{desc}</small></div>)}</section>
    <div className="section-heading"><h2>全部岗位</h2><span>按最近更新排序</span></div>
    {jobs.length ? <div className="job-grid">{jobs.map(j=><Link href={`/jobs/${j.id}`} className="job-card" key={j.id}><div className="job-icon"><BriefcaseBusiness size={22}/></div><h2>{j.name}</h2><p>{j.department||"未设置部门"} · {j.location||"未设置地点"}</p><div className="job-stats"><span><b>{j.count||0}</b> 位候选人</span><span><b>{j.high||0}</b> 位高优先级</span></div><footer><span>+{j.today||0} 最近 24 小时 · {dateText(j.updated)}</span><ArrowUpRight size={17}/></footer></Link>)}</div> : <section className="empty-workspace"><div className="empty-icon"><FileText size={30}/></div><h2>从你的第一个岗位开始</h2><p>粘贴 JD，生成并校准专属评分卡。<br/>随后上传简历，自动获得有证据的匹配评分。</p><div className="empty-actions"><Button className="primary" onClick={()=>router.push("/jobs/new")}><Plus size={17}/>创建第一个岗位</Button>{DEMO_MODE&&<Button variant="outline" disabled={seeding} onClick={loadSample}>{seeding?<LoaderCircle className="spin" size={16}/>:<Sparkles size={16}/>}载入示例数据</Button>}</div><div className="flow"><span>01 岗位画像</span><ChevronRight/><span>02 校准评分卡</span><ChevronRight/><span>03 上传与排序</span></div></section>}
    <div className="bottom-note"><ShieldCheck size={16}/>评分仅表示岗位匹配与查看优先级，最终招聘决策由你做出。</div>
  </main></SidebarInset></SidebarProvider>;
}
