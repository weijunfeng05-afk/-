'use client';
import {useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import {supabaseBrowser} from '@/lib/supabase/browser';
export default function Account(){
  const path=usePathname(),[email,setEmail]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    const client=supabaseBrowser();
    client.auth.getUser().then(({data})=>setEmail(data.user?.email||''));
    const {data}=client.auth.onAuthStateChange((event,session)=>{setEmail(session?.user.email||'');if(event==='SIGNED_OUT')location.replace('/login');});
    return ()=>data.subscription.unsubscribe();
  },[]);
  if(path==='/login'||!email)return null;
  return <div style={{padding:'8px 24px',textAlign:'right',background:'#eef2ff',fontSize:14}}>{email} <button onClick={async()=>{const {error}=await supabaseBrowser().auth.signOut({scope:'local'});if(error)setError('退出失败，请重试');else location.replace('/login');}}>退出登录</button><span role="status">{error}</span></div>;
}
