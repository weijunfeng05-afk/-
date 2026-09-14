'use client';
import {useState} from 'react';
import {api,send} from '@/lib/client';
import {Button} from './ui/button';
type Job={id:string;version:number;name:string;jd:string;department:string;location:string;level:string;notes:string};
export default function JobEditor({job,locked,onSaved}:{job:Job;locked:boolean;onSaved:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(locked&&!window.confirm('修改 JD 后将清空旧分数。重新生成并确认评分卡后，全部候选人会按新标准分析。是否继续？'))return;
  const form=new FormData(e.currentTarget);setBusy(true);setError('');
  try{await api('jobs/'+job.id,send({name:form.get('name'),jd:form.get('jd'),department:job.department,location:job.location,level:job.level,notes:job.notes,version:job.version,reanalyze:locked},'PUT'));await onSaved()}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <details className="panel"><summary>修改岗位名称 / JD</summary><form onSubmit={submit} style={{display:'grid',gap:12}}><label>岗位名称<input name="name" required maxLength={100} defaultValue={job.name}/></label><label>岗位描述<textarea name="jd" required minLength={30} maxLength={40000} rows={10} defaultValue={job.jd} style={{display:'block',width:'100%'}}/></label><p>保存后 AI 会重新生成评分卡，确认新标准后再分析候选人。</p><Button disabled={busy} type="submit">{busy?'正在保存…':'保存并重新生成评分卡'}</Button>{error&&<p role="alert">{error}</p>}</form></details>;
}
