import {useState} from 'react';
import {api,cloudMode} from './api';

export default function CloudAccess({children}:{children:React.ReactNode}) {
  const [ready,setReady]=useState(!cloudMode),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if(ready)return <>{children}{cloudMode&&<button style={{position:'fixed',bottom:12,right:12}} onClick={()=>{sessionStorage.removeItem('resume-access-token');setReady(false);}}>退出工作空间</button>}</>;
  return <main style={{maxWidth:480,margin:'10vh auto'}}><h1>进入简历工作空间</h1><p>填写后端配置的工作空间访问密钥。</p><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');sessionStorage.setItem('resume-access-token',key);try{await api('/jobs');setReady(true);setKey('');}catch(err){sessionStorage.removeItem('resume-access-token');setError((err as Error).message);}finally{setBusy(false);}}}><label>工作空间访问密钥<input type="password" required value={key} onChange={e=>setKey(e.target.value)} autoComplete="off"/></label>{error&&<p role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?'正在验证…':'进入工作空间'}</button></form></main>;
}
