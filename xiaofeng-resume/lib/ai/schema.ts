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
const normalize=(s:string)=>s.replace(/\s+/g,'');
export function validateEvaluation(raw:unknown,card:Scorecard,resume:string):Evaluation{
 const r=evaluationSchema.parse(raw); const text=normalize(resume);
 if(r.dimension_scores.length!==card.dimensions.length||new Set(r.dimension_scores.map(x=>x.id)).size!==card.dimensions.length)throw Error('评分维度不完整');
 for(const d of r.dimension_scores){const expected=card.dimensions.find(x=>x.id===d.id);if(!expected||d.score>expected.weight)throw Error('分项分数越界');if(d.score>0&&!d.evidence.length)throw Error('有得分但缺少证据');for(const quote of d.evidence)if(!text.includes(normalize(quote)))throw Error('评分证据无法追溯到简历原文');}
 if(r.must_have.length!==card.must_have.length||new Set(r.must_have.map(x=>x.requirement)).size!==card.must_have.length)throw Error('Must-have 结果不完整');
 for(const m of r.must_have){if(!card.must_have.includes(m.requirement))throw Error('Must-have 不匹配');if(m.status!=='unknown'&&!m.evidence)throw Error('明确状态必须有原文证据');if(m.evidence&&!text.includes(normalize(m.evidence)))throw Error('Must-have 证据不是原文');}
 if(sensitive.test(JSON.stringify({scores:r.dimension_scores,strengths:r.strengths,risks:r.risks,must_have:r.must_have,unknowns:r.unknowns,interview_questions:r.interview_questions})))throw Error('评价包含敏感个人属性');
 const score=r.dimension_scores.reduce((s,d)=>s+d.score,0);return {...r,total_score:score,match_level:matchLevel(score)};
}
