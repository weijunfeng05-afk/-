'use client';
import {useState} from 'react';
import {ArrowRight,CheckCircle2,KeyRound,LoaderCircle,Lock,Mail,ShieldCheck,Sparkles} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {supabaseBrowser} from '@/lib/supabase/browser';
import {DEMO_MODE,SIMPLE_LOGIN,SIMPLE_PASSWORD,writeSessionEmail} from '@/lib/simple-auth';

// 把 Supabase 的英文错误转成可执行的中文提示。
function registerError(raw:string){
  if(/already registered|already exists/i.test(raw))return '该邮箱已经注册过了，请直接登录。';
  if(/password/i.test(raw))return '密码不符合要求：至少 8 位，建议包含字母和数字。';
  if(/rate limit|too many/i.test(raw))return '请求过于频繁，请稍后再试。';
  if(/invite|邀请码|封闭内测/i.test(raw))return '邀请码无效、已被使用或与邮箱不匹配。';
  return '注册失败：'+raw;
}
function loginError(raw:string){
  if(/invalid login credentials/i.test(raw))return '邮箱或密码不正确。';
  if(/email not confirmed/i.test(raw))return '邮箱尚未验证，请先点击邮件中的验证链接。';
  if(/rate limit|too many/i.test(raw))return '请求过于频繁，请稍后再试。';
  return '登录失败：'+raw;
}

export default function Login() {
  const [register,setRegister]=useState(false), [busy,setBusy]=useState(false), [message,setMessage]=useState('');
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const email=String(data.get('email')||'').trim();
    const password=String(data.get('password')||'');

    // 内测简易登录：邮箱即账号，校验统一密码后写入本地标识，全程不经过 Supabase。
    if(SIMPLE_LOGIN) {
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {setMessage('请输入有效的邮箱地址。');return;}
      if(password!==SIMPLE_PASSWORD) {setMessage('密码不正确，内测统一密码为 '+SIMPLE_PASSWORD+'。');return;}
      setBusy(true); setMessage('');
      writeSessionEmail(email);
      location.replace('/');
      return;
    }

    if(DEMO_MODE) {setMessage('演示模式未连接认证服务；配置 Supabase 后会向真实服务提交登录请求。');return;}
    setBusy(true); setMessage('');
    try {
      const auth=supabaseBrowser().auth;
      const invite=String(data.get('invite')||'').trim();
      const result=register
        ? await auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/auth/callback',...(invite?{data:{beta_invite:invite}}:{})}})
        : await auth.signInWithPassword({email,password});
      if(result.error) {setMessage(register?registerError(result.error.message):loginError(result.error.message));return;}
      if(result.data.session) location.replace('/');
      else if(register&&result.data.user&&!result.data.user.identities?.length) setMessage('该邮箱已经注册过了，请直接登录；忘记密码可联系管理员重置。');
      else setMessage('注册成功，请前往邮箱点击验证链接，验证后即可登录。');
    } catch {setMessage('连接失败，请检查网络后重试。');} finally {setBusy(false);}
  }
  return <div className="auth-shell">
    <aside className="auth-hero">
      <span className="brand-icon">锋</span>
      <div className="auth-hero-copy">
        <h1>小锋牌简历筛选机</h1>
        <p>把岗位标准变成可校准的评分卡，让每一份简历的判断都有证据可依。</p>
      </div>
      <ul className="auth-points">
        <li><ShieldCheck size={18}/><div><b>证据驱动</b><span>每条评分都能追溯到简历原文</span></div></li>
        <li><Sparkles size={18}/><div><b>岗位专属标准</b><span>按 JD 生成评分维度，支持人工校准</span></div></li>
        <li><Lock size={18}/><div><b>数据隔离</b><span>简历仅你可见，密钥加密保存</span></div></li>
      </ul>
    </aside>
    <main className="auth-main">
      <section className="auth-card">
        {SIMPLE_LOGIN ? <>
          <span className="auth-badge"><KeyRound size={14}/>内测账号</span>
          <h2>登录</h2>
          <p>用你自己的邮箱即可登录，无需注册，也不需要邀请码。</p>
          <form onSubmit={submit} noValidate>
            <label className="auth-field">邮箱
              <Input name="email" type="email" required autoComplete="email" placeholder="you@company.com"/>
            </label>
            <label className="auth-field">密码
              <Input name="password" type="password" defaultValue={SIMPLE_PASSWORD} required autoComplete="current-password"/>
              <small>内测期统一密码：{SIMPLE_PASSWORD}（已预填，直接点登录即可）。</small>
            </label>
            {message&&<p className="auth-message" role="status">{message}</p>}
            <Button className="primary auth-submit" disabled={busy} type="submit">
              {busy?<LoaderCircle className="spin" size={17}/>:<Lock size={17}/>}登录工作空间
            </Button>
          </form>
          <p className="auth-note"><ShieldCheck size={13}/>内测简易登录：密码仅作流程演示，不含真实安全校验。</p>
        </> : <>
          {DEMO_MODE&&<p className="auth-demo"><CheckCircle2 size={14}/><span>本地演示模式：以下是真实登录界面，但不会连接认证服务。</span></p>}
          <span className="auth-badge">{register?<Sparkles size={14}/>:<Lock size={14}/>}{register?'创建账号':'招聘工作空间'}</span>
          <h2>{register?'注册':'登录'}</h2>
          <p>{register?'用你的邮箱注册，独立的空间只保存你自己的岗位与简历。':'使用你的账号进入简历筛选工作台。'}</p>
          <form onSubmit={submit} noValidate>
            <label className="auth-field">邮箱
              <Input name="email" type="email" required autoComplete="email" placeholder="you@company.com"/>
            </label>
            <label className="auth-field">密码
              <Input name="password" type="password" minLength={8} required autoComplete={register?'new-password':'current-password'} placeholder={register?'至少 8 位，建议字母+数字':'请输入密码'}/>
              {register&&<small>至少 8 位，建议包含字母与数字。</small>}
            </label>
            {register&&<label className="auth-field">邀请码（选填）
              <Input name="invite" maxLength={128} autoComplete="off" placeholder="没有邀请码可留空"/>
              <small>当前为开放注册；若管理员发放了邀请码，请在此填写。</small>
            </label>}
            {message&&<p className={message.startsWith('注册成功')||message.startsWith('该邮箱已经')?'auth-message ok':'auth-message'} role="status">{message.startsWith('注册成功')&&<Mail size={15}/>}{message}</p>}
            <Button className="primary auth-submit" disabled={busy} type="submit">
              {busy?<LoaderCircle className="spin" size={17}/>:register?<Sparkles size={17}/>:<Lock size={17}/>}
              {busy?'请稍候…':register?'创建账号':'登录工作空间'}
            </Button>
          </form>
          <div className="auth-switch">
            {register?'已经有账号了？':'还没有账号？'}
            <button type="button" disabled={busy} onClick={()=>{setRegister(!register);setMessage('');}}>{register?'直接登录':'注册新账号'}</button>
          </div>
          {DEMO_MODE&&<div className="auth-demo-enter"><Button variant="outline" onClick={()=>location.replace('/')}>跳过登录，进入演示工作台<ArrowRight size={15}/></Button></div>}
        </>}
      </section>
      <p className="auth-footnote"><ShieldCheck size={14}/>评分仅表示岗位匹配与查看优先级，最终招聘决策由你做出。</p>
    </main>
  </div>;
}
