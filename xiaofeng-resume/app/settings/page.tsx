"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, PlugZap, ShieldCheck, Trash2 } from "lucide-react";
import Shell from "@/components/workspace-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { api, send } from "@/lib/client";

type Settings = { configured:boolean; masked_key:string|null; job_model:string; resume_model:string; version:number; updated_at:number|null; provider:string; endpoint:string };
const models = [{value:"deepseek-v4-pro",label:"DeepSeek V4 Pro",hint:"复杂岗位理解"},{value:"deepseek-v4-flash",label:"DeepSeek V4 Flash",hint:"快速、低成本"}];

export default function ApiSettingsPage() {
  const [settings,setSettings]=useState<Settings|null>(null), [key,setKey]=useState(""), [show,setShow]=useState(false);
  const [jobModel,setJobModel]=useState("deepseek-v4-pro"), [resumeModel,setResumeModel]=useState("deepseek-v4-flash");
  const [busy,setBusy]=useState<"test"|"save"|"remove"|null>(null), [message,setMessage]=useState(""), [error,setError]=useState("");
  useEffect(()=>{api("settings/ai").then((s:Settings)=>{setSettings(s);setJobModel(s.job_model);setResumeModel(s.resume_model)}).catch(e=>setError(e.message))},[]);
  const payload=()=>({api_key:key||undefined,job_model:jobModel,resume_model:resumeModel,version:settings?.version||0});
  async function run(type:"test"|"save") { setBusy(type);setError("");setMessage("");try { const result=await api("settings/ai"+(type==="test"?"/test":""),send(payload(),type==="test"?"POST":"PUT"));setMessage(type==="test"?`连接成功，${result.checks.map((x:any)=>`${x.model} ${x.latency_ms}ms`).join("；")}`:"API 配置已加密保存，后续分析会使用你的配置。");if(type==="save"){setSettings(result);setKey("")}} catch(e){setError((e as Error).message)} finally {setBusy(null)} }
  async function remove(){setBusy("remove");setError("");try{const result=await api("settings/ai",send({version:settings?.version||0},"DELETE"));setSettings(result);setKey("");setMessage("已移除你的 API 配置，已有岗位和评分结果不受影响。")}catch(e){setError((e as Error).message)}finally{setBusy(null)}}
  return <Shell label="返回工作空间"><div className="page-heading"><div><p className="eyebrow">PERSONAL AI CONNECTION</p><h1>API 设置</h1><p className="muted">内测默认使用平台额度，也可以填写自己的 DeepSeek API Key。</p></div>{settings?.configured&&<span className="connection-ok"><CheckCircle2 size={16}/>已连接</span>}</div>
    <div className="settings-layout"><section className="panel settings-panel"><div className="settings-title"><span><KeyRound size={21}/></span><div><h2>DeepSeek API</h2><p>OpenAI 兼容接口 · https://api.deepseek.com</p></div></div>
      <label>API Key<div className="secret-input"><Input type={show?"text":"password"} autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} placeholder={settings?.masked_key?`${settings.masked_key}（留空表示不更换）`:"粘贴你的 DeepSeek API Key"}/><Button type="button" variant="ghost" aria-label={show?"隐藏密钥":"显示密钥"} onClick={()=>setShow(!show)}>{show?<EyeOff size={17}/>:<Eye size={17}/>}</Button></div><small>密钥提交后立即加密，页面不会再次显示完整内容。</small></label>
      <div className="settings-models"><label>岗位理解模型<Select value={jobModel} onValueChange={setJobModel}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{models.map(m=><SelectItem value={m.value} key={m.value}>{m.label} · {m.hint}</SelectItem>)}</SelectContent></Select><small>低频、复杂任务，建议使用 Pro。</small></label><label>简历筛选模型<Select value={resumeModel} onValueChange={setResumeModel}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{models.map(m=><SelectItem value={m.value} key={m.value}>{m.label} · {m.hint}</SelectItem>)}</SelectContent></Select><small>高频筛选，建议使用 Flash。</small></label></div>
      {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="success-message"><CheckCircle2 size={16}/>{message}</p>}
      <div className="settings-actions"><Button variant="outline" disabled={!!busy||(!key&&!settings?.configured)} onClick={()=>run("test")}>{busy==="test"?<LoaderCircle className="spin" size={16}/>:<PlugZap size={16}/>}测试连接</Button><Button className="primary" disabled={!!busy||(!key&&!settings?.configured)} onClick={()=>run("save")}>{busy==="save"?<LoaderCircle className="spin" size={16}/>:<ShieldCheck size={16}/>}测试并保存</Button></div>
      {settings?.masked_key&&<div className="remove-setting"><div><b>移除当前配置</b><p>移除后恢复使用平台额度；不会删除岗位、简历或已有评分。</p></div><AlertDialog><AlertDialogTrigger asChild><Button variant="ghost"><Trash2 size={15}/>移除</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>移除你的 DeepSeek 配置？</AlertDialogTitle><AlertDialogDescription>移除后将使用平台密钥和内测额度，已有数据和结果会继续保留。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={remove}>确认移除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}
    </section><aside className="settings-aside"><ShieldCheck size={26}/><h2>可选：使用自己的密钥</h2><p>每个登录账户拥有自己的加密配置。其他用户无法查看、替换或使用你的密钥。</p><ul><li>完整密钥不回显</li><li>保存前验证密钥和模型</li><li>修改使用版本校验，避免相互覆盖</li><li>密钥不会进入 GitHub 或前端代码</li></ul></aside></div></Shell>
}
