'use client';
import {useState} from 'react';
import {supabaseBrowser} from '@/lib/supabase/browser';
export default function Login() {
  const [register,setRegister]=useState(false), [busy,setBusy]=useState(false), [message,setMessage]=useState('');
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const data=new FormData(event.currentTarget), email=String(data.get('email')).trim(), password=String(data.get('password'));
    try {
      const auth=supabaseBrowser().auth;
      const result=register ? await auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/auth/callback',data:{beta_invite:String(data.get('invite')||'').trim()}}}) : await auth.signInWithPassword({email,password});
      if(result.error) {setMessage(register?'当前产品处于封闭内测阶段，请检查邮箱专属邀请码及密码。':'登录失败，请检查邮箱、密码及邮箱验证状态。');return;}
      if(result.data.session) location.replace('/'); else setMessage('请检查邮箱并点击验证链接，验证后即可登录。');
    } catch {setMessage('连接失败，请稍后重试。');} finally {setBusy(false);}
  }
  return <main style={{maxWidth:420,margin:'12vh auto',padding:24}}><h1>小锋牌简历</h1><p>{register?'凭邀请码申请内测':'招聘简历 AI Copilot'}</p>
    <form onSubmit={submit} style={{display:'grid',gap:16}}>
      <label>邮箱<input style={{display:'block',width:'100%',padding:12,border:'1px solid #aaa'}} name="email" type="email" required autoComplete="email"/></label>
      <label>密码<input style={{display:'block',width:'100%',padding:12,border:'1px solid #aaa'}} name="password" type="password" minLength={8} required autoComplete={register?'new-password':'current-password'}/></label>
      <>{register&&<label>Beta 邀请码<input name="invite" required maxLength={128} autoComplete="off" style={{display:"block",width:"100%",padding:12,border:"1px solid #aaa"}}/></label>}</><button className="primary" disabled={busy} type="submit">{busy?'请稍候…':register?'注册':'登录'}</button><p role="status">{message}</p>
    </form><button disabled={busy} onClick={()=>{setRegister(!register);setMessage('');}}>{register?'已有账号？登录':'没有账号？申请内测'}</button>
  </main>;
}
