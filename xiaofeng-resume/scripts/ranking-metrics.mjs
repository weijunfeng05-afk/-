import {readFileSync} from 'node:fs';
// Input: [{id,human_rank,ai_score}], optional time measurements in seconds.
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/ranking-metrics.mjs dataset.json [manual_seconds] [assisted_seconds]');
const rows=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(rows)||rows.length<10)throw Error('Provide at least 10 anonymized candidates');
if(new Set(rows.map(x=>x.id)).size!==rows.length||rows.some(x=>!Number.isFinite(x.ai_score)||x.ai_score<0||x.ai_score>100||!Number.isInteger(x.human_rank)||x.human_rank<1)||new Set(rows.map(x=>x.human_rank)).size!==rows.length)throw Error('Invalid scores, duplicate IDs or human ranks');
const human=[...rows].sort((a,b)=>a.human_rank-b.human_rank),ai=[...rows].sort((a,b)=>b.ai_score-a.ai_score||String(a.id).localeCompare(String(b.id)));
const recall=k=>{const top=new Set(human.slice(0,k).map(x=>x.id));return ai.slice(0,k).filter(x=>top.has(x.id)).length/k};
// Spearman correlation via Pearson of average ranks (ties handled).
const rank=new Map();for(let i=0;i<ai.length;){let end=i+1;while(end<ai.length&&ai[end].ai_score===ai[i].ai_score)end++;for(let j=i;j<end;j++)rank.set(ai[j].id,(i+1+end)/2);i=end;}
const x=human.map((_,i)=>i+1),y=human.map(r=>rank.get(r.id)),avg=a=>a.reduce((s,v)=>s+v,0)/a.length,mx=avg(x),my=avg(y);const cov=x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0),den=Math.sqrt(x.reduce((s,v)=>s+(v-mx)**2,0)*y.reduce((s,v)=>s+(v-my)**2,0));
const manual=Number(process.argv[3]),assisted=Number(process.argv[4]);
console.log(JSON.stringify({count:rows.length,top_5_recall:recall(5),top_10_recall:recall(10),spearman:den?cov/den:null,tie_break:'candidate ID ascending; review boundary ties',time_saved_seconds:manual>0&&assisted>=0?manual-assisted:null,time_saved_ratio:manual>0&&assisted>=0?(manual-assisted)/manual:null},null,2));
