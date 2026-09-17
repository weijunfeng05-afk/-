'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {usePathname} from 'next/navigation';
import {LogOut,UserRound} from 'lucide-react';
import {supabaseBrowser} from '@/lib/supabase/browser';
import {LOCAL_MODE,SIMPLE_LOGIN,clearSessionEmail,notifySessionChange,readSessionEmail,subscribeSession} from '@/lib/simple-auth';
export default function Account(){
  const path=usePathname(),[error,setError]=useState(''),[supabaseEmail,setSupabaseEmail]=useState('');
  // 内测简易登录：把 cookie 当作外部数据源订阅，避免在 effect 中同步 setState 引发级联渲染。
  const simpleEmail=useSyncExternalStore(subscribeSession,readSessionEmail,()=>'');

  useEffect(()=>{
    // 简易登录与本地模式（演示/真实 AI）都不需要初始化 Supabase 客户端。
    if(SIMPLE_LOGIN||LOCAL_MODE)return;
    const client=supabaseBrowser();
    client.auth.getUser().then(({data})=>setSupabaseEmail(data.user?.email||''));
    const {data}=client.auth.onAuthStateChange((event,session)=>{setSupabaseEmail(session?.user.email||'');if(event==='SIGNED_OUT')location.replace('/login');});
    return ()=>data.subscription.unsubscribe();
  },[]);

  const email=SIMPLE_LOGIN?simpleEmail:supabaseEmail;

  async function signOut(){
    if(SIMPLE_LOGIN){clearSessionEmail();notifySessionChange();location.replace('/login');return;}
    const {error:signOutError}=await supabaseBrowser().auth.signOut({scope:'local'});
    if(signOutError)setError('退出失败，请重试');else location.replace('/login');
  }

  if(path==='/login'||!email)return null;
  return <div className="account-bar">
    <span className="account-bar-mail"><UserRound size={14}/>{email}</span>
    <button type="button" onClick={signOut}><LogOut size={14}/>退出登录</button>
    <span role="status" className="account-bar-error">{error}</span>
  </div>;
}
