import {z} from 'zod';
const short=z.string().trim().min(1).max(300);
export const dimension=z.object({id:z.string().min(1).max(80),name:short,weight:z.number().int().min(1).max(100),rubric:z.string().trim().min(1).max(800)}).strict();
const sensitive=/(性别|男性|女性|已婚|未婚|户籍|婚姻|婚育|生育|民族|宗教|照片|籍贯|年龄|国籍|出生日期|政治面貌|党派|疾病|残疾|残障|怀孕|健康情况|生育计划|家庭状况|nationality|disability|pregnan|political affiliation|gender|marital|religion|ethnic|birth|age requirement)/i;
export const cardSchema=z.object({dimensions:z.array(dimension).min(1).max(12),must_have:z.array(short).max(15),nice_to_have:z.array(short).max(15)}).strict().superRefine((c,ctx)=>{
 if(c.dimensions.reduce((a,d)=>a+d.weight,0)!==100)ctx.addIssue({code:'custom',message:'评分卡权重必须合计 100%'});
 if(new Set(c.dimensions.map(d=>d.id)).size!==c.dimensions.length||new Set(c.dimensions.map(d=>d.name)).size!==c.dimensions.length)ctx.addIssue({code:'custom',message:'评分维度不能重复'});
 if(sensitive.test(JSON.stringify(c)))ctx.addIssue({code:'custom',message:'评分标准不能包含敏感个人属性'});
});
export const profileSchema=z.object({summary:short,responsibilities:z.array(short).max(12),keywords:z.array(short).max(20)}).strict();
export const jobOutput=z.object({profile:profileSchema,scorecard:cardSchema}).strict();
export const jobInput=z.object({name:z.string().trim().min(1).max(100),jd:z.string().trim().min(30).max(40000),department:z.string().max(100).default(''),location:z.string().max(100).default(''),level:z.string().max(100).default(''),notes:z.string().max(1000).default('')});
const fact=z.string().max(300);
const education=z.object({school:fact,degree:z.string().max(100),major:z.string().max(100)});
const experience=z.object({company:fact,role:fact,start:z.string().max(30),end:z.string().max(30),responsibilities:z.array(short).max(10)});
const project=z.object({name:fact,background:z.string().max(500),role:z.string().max(300),methods:z.array(short).max(10),results:z.array(short).max(10)});
export const candidateProfile=z.object({name:z.string().max(100),education:z.array(education).max(10),experience:z.array(experience).max(20),projects:z.array(project).max(20),skills:z.array(short).max(50),achievements:z.array(short).max(20)}).strict();
export const evaluationSchema=z.object({candidate_profile:candidateProfile,dimension_scores:z.array(z.object({id:z.string(),score:z.number().int().min(0).max(100),evidence:z.array(short).max(3),reason:short})).min(1).max(12),strengths:z.array(short).max(3),risks:z.array(short).max(3),must_have:z.array(z.object({requirement:short,status:z.enum(['met','unmet','unknown']),evidence:z.string().max(300)})).max(15),unknowns:z.array(short).max(15).default([]),interview_questions:z.array(short).max(15).default([]),confidence:z.number().min(0).max(1)}).strict();
export type Scorecard=z.infer<typeof cardSchema>;
export type Evaluation=z.infer<typeof evaluationSchema>&{total_score:number;match_level:string};
export const matchLevel=(score:number)=>score>=85?'high':score>=70?'recommended':score>=55?'review':'low';
const normalize=(s:string)=>s.toLowerCase().replace(/[^0-9a-z\u4e00-\u9fff]/g,'');

// —— 证据溯源 ——
// 规则：AI 引用的证据必须能在简历原文中找到，否则该维度按「信息不足」处理。
// 先做逐字匹配；逐字失败时再退化为「相似度匹配」：把简历切成小段，只要存在一段与引用高度重合
// （默认 75%）就认定有据可依。这样能容忍标点、换行与轻微措辞差异，避免有真实经历的候选人被误判为 0 分，
// 同时仍然拒绝无中生有的证据。
const EVIDENCE_MATCH_THRESHOLD=0.75;
const EVIDENCE_MIN_QUOTE=7;
function bigrams(s:string){
  const set=new Set<string>();
  for(let i=0;i+1<s.length;i++)set.add(s.slice(i,i+2));
  return set;
}
function makeEvidenceIndex(resume:string){
  const text=normalize(resume);
  // 先按句号/分号/换行切段再归一化，避免逗号把一句话切碎；过长段落再按窗口切片，防止相似度被稀释。
  const windows:string[]=[];
  for(const seg of resume.split(/[。！？；\n\r]+/).map(normalize)){
    if(seg.length<4)continue;
    if(seg.length<=200)windows.push(seg);
    else for(let i=0;i<seg.length;i+=100)windows.push(seg.slice(i,i+200));
  }
  const sets=windows.map(bigrams);
  return (quote:string)=>{
    const q=normalize(quote);
    if(!q)return false;
    if(text.includes(q))return true;
    if(q.length<EVIDENCE_MIN_QUOTE)return false;
    const grams=bigrams(q);
    if(grams.size<5)return false;
    for(const s of sets){
      let hit=0;
      for(const g of grams)if(s.has(g))hit++;
      if(hit/grams.size>=EVIDENCE_MATCH_THRESHOLD)return true;
    }
    return false;
  };
}

// —— 大模型输出容错 ——
// DeepSeek 偶发会超出数组/字符串上限（如 strengths 多一两条、summary 超过 300 字），
// 导致严格 Zod 校验整体失败。这里在进校验前做一次「截断到上限」的规整，只裁掉多余部分。
const clip=(v:unknown,n:number)=>typeof v==='string'?v.slice(0,n):v;
const cut=(v:unknown,n:number):any[]=>Array.isArray(v)?v.slice(0,n):[];
const clip300=(v:unknown)=>clip(v,300);

function normalizeEvaluation(raw:unknown){
  if(!raw||typeof raw!=='object')return raw;
  const src=raw as any;
  const cp=src.candidate_profile&&typeof src.candidate_profile==='object'?src.candidate_profile:undefined;
  const candidate_profile=cp?{
    name:clip(cp.name,100),
    education:cut(cp.education,10).map((e:any)=>({school:clip300(e?.school),degree:clip(e?.degree,100),major:clip(e?.major,100)})),
    experience:cut(cp.experience,20).map((e:any)=>({company:clip300(e?.company),role:clip300(e?.role),start:clip(e?.start,30),end:clip(e?.end,30),responsibilities:cut(e?.responsibilities,10).map(clip300)})),
    projects:cut(cp.projects,20).map((p:any)=>({name:clip300(p?.name),background:clip(p?.background,500),role:clip300(p?.role),methods:cut(p?.methods,10).map(clip300),results:cut(p?.results,10).map(clip300)})),
    skills:cut(cp.skills,50).map(clip300),
    achievements:cut(cp.achievements,20).map(clip300),
  }:undefined;
  const dimension_scores=cut(src.dimension_scores,12).map((d:any)=>({id:d?.id,score:Number.isFinite(Number(d?.score))?Math.round(Number(d?.score)):0,evidence:cut(d?.evidence,3).map(clip300),reason:clip300(d?.reason)}));
  const must_have=cut(src.must_have,15).map((m:any)=>({requirement:clip300(m?.requirement),status:m?.status,evidence:clip300(m?.evidence)}));
  return {
    candidate_profile,
    dimension_scores,
    strengths:cut(src.strengths,3).map(clip300),
    risks:cut(src.risks,3).map(clip300),
    must_have,
    unknowns:cut(src.unknowns,15).map(clip300),
    interview_questions:cut(src.interview_questions,15).map(clip300),
    confidence:src.confidence==null?0.5:Number(src.confidence),
  };
}

export function validateEvaluation(raw:unknown,card:Scorecard,resume:string):Evaluation{
 const r=evaluationSchema.parse(normalizeEvaluation(raw)); const traceable=makeEvidenceIndex(resume);
 if(r.dimension_scores.length!==card.dimensions.length||new Set(r.dimension_scores.map(x=>x.id)).size!==card.dimensions.length)throw Error('评分维度不完整');
 for(const d of r.dimension_scores){const expected=card.dimensions.find(x=>x.id===d.id);if(!expected)throw Error('评分维度与评分卡不一致');
  // 模型偶尔会把分项分数写到权重上限之上（例如 25 分维度给 30 分），按上限截断而不是让整份评分失败。
  if(d.score>expected.weight){d.score=expected.weight;d.reason=(d.reason||'')+'（分项分数超出权重上限，已按上限计入）';}
  if(d.score<0)d.score=0;
  d.evidence=d.evidence.filter(quote=>traceable(quote));if(d.score>0&&!d.evidence.length){d.score=0;d.reason=(d.reason||'')+'（证据无法追溯到简历原文，已按信息不足处理）';}}
 if(r.must_have.length!==card.must_have.length||new Set(r.must_have.map(x=>x.requirement)).size!==card.must_have.length)throw Error('Must-have 结果不完整');
 for(const m of r.must_have){if(!card.must_have.includes(m.requirement))throw Error('Must-have 不匹配');if(m.status!=='unknown'&&(!m.evidence||!traceable(m.evidence))){m.status='unknown';m.evidence='';}}
 if(sensitive.test(JSON.stringify({scores:r.dimension_scores,strengths:r.strengths,risks:r.risks,must_have:r.must_have,unknowns:r.unknowns,interview_questions:r.interview_questions})))throw Error('评价包含敏感个人属性');
 const score=r.dimension_scores.reduce((s,d)=>s+d.score,0);return {...r,total_score:score,match_level:matchLevel(score)};
}

/** 岗位输出同样先容错规整（含权重合计修正）再严格校验。 */
export function parseJobOutput(raw:unknown){
  const src=(raw&&typeof raw==='object'?raw:{}) as any;
  const profile=src.profile&&typeof src.profile==='object'?{
    summary:clip300(src.profile.summary),
    responsibilities:cut(src.profile.responsibilities,12).map(clip300),
    keywords:cut(src.profile.keywords,20).map(clip300),
  }:src.profile;
  let scorecard=src.scorecard;
  if(scorecard&&typeof scorecard==='object'){
    const dimensions=cut(scorecard.dimensions,12).map((d:any)=>({id:clip(d?.id,80),name:clip300(d?.name),weight:Number(d?.weight),rubric:clip(d?.rubric,800)}));
    const weights=dimensions.map((d:any)=>Number(d.weight));
    const sum=weights.reduce((a,b)=>a+(Number.isFinite(b)?b:0),0);
    // 仅当所有维度都是合法整数、只是合计有舍入偏差时，才把差额补到权重最大的维度上。
    if(sum!==100&&dimensions.length&&weights.every(w=>Number.isInteger(w)&&w>=1&&w<=100)){
      const delta=100-sum;
      const largest=dimensions.slice().sort((a:any,b:any)=>b.weight-a.weight)[0];
      const idx=dimensions.indexOf(largest);
      const next=largest.weight+delta;
      if(idx>=0&&next>=1&&next<=100)dimensions[idx]={...dimensions[idx],weight:next};
    }
    scorecard={dimensions,must_have:cut(scorecard.must_have,15).map(clip300),nice_to_have:cut(scorecard.nice_to_have,15).map(clip300)};
  }
  return jobOutput.parse({profile,scorecard});
}
