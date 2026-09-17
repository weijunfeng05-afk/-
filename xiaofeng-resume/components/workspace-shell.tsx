"use client";
import Link from "next/link";
import {ArrowLeft,KeyRound,ShieldCheck} from 'lucide-react';
import {Toaster} from '@/components/ui/sonner';
export default function Shell({children,back='/',label='我的岗位'}:{children:React.ReactNode;back?:string;label?:string}){return <><header className="detail-topbar"><Link className="brand compact" href="/"><span className="brand-icon">锋</span><span>小锋牌简历筛选机</span></Link><a className="back-link" href={back}><ArrowLeft size={15}/>{label}</a><a className="settings-link" href="/settings"><KeyRound size={15}/>API 设置</a><span className="secure"><ShieldCheck size={15}/>证据驱动 · 人工决策</span></header><main className="detail-workspace">{children}</main><Toaster richColors position="top-center"/></>}
