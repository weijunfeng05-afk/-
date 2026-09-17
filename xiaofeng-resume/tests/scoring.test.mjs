import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/ai/schema.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/test-schema.mjs'});
const {cardSchema,validateEvaluation,matchLevel}=await import('../work/test-schema.mjs');
const card={dimensions:[{id:'d1',name:'项目经验',weight:100,rubric:'零分无证据；中等分参与；高分独立上线且有结果'}],must_have:['Agent 项目'],nice_to_have:[]};
const resume='负责多 Agent 工作流设计，完成知识库上线，服务 1000 位用户。';
const fixture=()=>({candidate_profile:{name:'',education:[],experience:[],projects:[],skills:[],achievements:[]},dimension_scores:[{id:'d1',score:86,evidence:['负责多 Agent 工作流设计'],reason:'有主导工作与上线成果'}],strengths:['有 Agent 项目经验'],risks:[],must_have:[{requirement:'Agent 项目',status:'met',evidence:'负责多 Agent 工作流设计'}],confidence:.88});
test('权重必须合计100且维度唯一',()=>{assert.ok(cardSchema.safeParse(card).success);assert.equal(cardSchema.safeParse({...card,dimensions:[{...card.dimensions[0],weight:99}]}).success,false);assert.equal(cardSchema.safeParse({...card,dimensions:[{...card.dimensions[0],weight:50},{...card.dimensions[0],weight:50}]}).success,false)});
test('后端计算分数及等级',()=>{const r=validateEvaluation(fixture(),card,resume);assert.equal(r.total_score,86);assert.equal(r.match_level,'high')});
test('全部等级临界点',()=>{assert.deepEqual([0,54,55,69,70,84,85,100].map(matchLevel),['low','low','review','review','recommended','recommended','high','high'])});
test('虚构证据被剔除且该维度归零',()=>{const r=fixture();r.dimension_scores[0].evidence=['主导千万用户产品'];const out=validateEvaluation(r,card,resume);assert.equal(out.dimension_scores[0].evidence.length,0);assert.equal(out.dimension_scores[0].score,0);assert.equal(out.total_score,0)});
test('允许PDF换行造成的空白差异',()=>{assert.equal(validateEvaluation(fixture(),card,resume.replace('工作流','工\n作流')).total_score,86)});
test('轻微改写或语序调整的证据仍可溯源',()=>{const r=fixture();r.dimension_scores[0].evidence=['完成知识库上线，负责多 Agent 工作流设计'];const out=validateEvaluation(r,card,resume);assert.equal(out.dimension_scores[0].evidence.length,1);assert.equal(out.total_score,86)});
test('重度改写或编造的证据被拒绝并归零',()=>{const r=fixture();r.dimension_scores[0].evidence=['主导千万级用户增长项目并实现营收翻倍'];const out=validateEvaluation(r,card,resume);assert.equal(out.dimension_scores[0].evidence.length,0);assert.equal(out.total_score,0)});
test('过短引用不做相似度兜底',()=>{const r=fixture();r.dimension_scores[0].evidence=['知识库系统'];const out=validateEvaluation(r,card,resume);assert.equal(out.dimension_scores[0].evidence.length,0);assert.equal(out.total_score,0)});
test('超出权重的分项分数被截断到上限而非整体失败',()=>{const two={dimensions:[{id:'d1',name:'项目经验',weight:60,rubric:'独立上线经验'},{id:'d2',name:'协作能力',weight:40,rubric:'跨团队协作'}],must_have:['Agent 项目'],nice_to_have:[]};const r=fixture();r.dimension_scores=[{id:'d1',score:80,evidence:['负责多 Agent 工作流设计'],reason:'经验丰富'},{id:'d2',score:40,evidence:['完成知识库上线'],reason:'有协作'}];const out=validateEvaluation(r,two,resume);assert.equal(out.dimension_scores[0].score,60);assert.equal(out.total_score,100);assert.match(out.dimension_scores[0].reason,/上限/)});
test('小数分数被取整',()=>{const r=fixture();r.dimension_scores[0].score=85.6;assert.equal(validateEvaluation(r,card,resume).total_score,86)});
test('维度数量或ID与评分卡不一致仍然报错',()=>{const r=fixture();r.dimension_scores=[fixture().dimension_scores[0],fixture().dimension_scores[0]];assert.throws(()=>validateEvaluation(r,card,resume));const r2=fixture();r2.dimension_scores[0].id='d9';assert.throws(()=>validateEvaluation(r2,card,resume))});
test('无证据的维度按信息不足归零而非报错',()=>{const r=fixture();r.dimension_scores[0].evidence=[];const out=validateEvaluation(r,card,resume);assert.equal(out.dimension_scores[0].score,0);assert.equal(out.total_score,0);assert.match(out.dimension_scores[0].reason,/信息不足/)});
test('Must-have缺证据只能unknown',()=>{const r=fixture();r.must_have[0].evidence='';r.must_have[0].status='unmet';const out=validateEvaluation(r,card,resume);assert.equal(out.must_have[0].status,'unknown');assert.equal(out.must_have[0].evidence,'');r.must_have[0].status='unknown';assert.ok(validateEvaluation(r,card,resume))});
test('拒绝敏感条件和评价',()=>{assert.equal(cardSchema.safeParse({...card,must_have:['性别男性']}).success,false);const r=fixture();r.risks=['年龄较大'];assert.throws(()=>validateEvaluation(r,card,resume))});
test('超长数组被截断到上限，置信度越界仍报错',()=>{const r=fixture();r.strengths=['a','b','c','d'];assert.equal(validateEvaluation(r,card,resume).strengths.length,3);r.strengths=[];r.confidence=1.1;assert.throws(()=>validateEvaluation(r,card,resume))});

test('未提及学校公司或项目名称可为空，不阻断已知事实评分',()=>{const r=fixture();r.candidate_profile.education=[{school:'',degree:'本科',major:'计算机科学'}];r.candidate_profile.experience=[{company:'',role:'产品经理',start:'',end:'',responsibilities:[]}];r.candidate_profile.projects=[{name:'',background:'企业知识库',role:'主导',methods:[],results:[]}];assert.equal(validateEvaluation(r,card,resume).total_score,86)});

test('扩展敏感属性均不能进入评分卡或评价',()=>{
 for(const term of ['国籍','出生日期','政治面貌','党派','疾病','残疾','残障','怀孕','健康情况','生育计划','家庭状况']){
  assert.equal(cardSchema.safeParse({...card,must_have:[term]}).success,false);
  const r=fixture();r.risks=[term];assert.throws(()=>validateEvaluation(r,card,resume));
 }
});
