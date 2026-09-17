import {isAllowedRequestOrigin} from '@/lib/request-origin';
// 本地演示模式：仅用于在没有 Supabase / PostgreSQL 的环境下预览真实界面。
// 通过 NEXT_PUBLIC_DEMO_MODE=true 开启，默认关闭，不改变任何生产逻辑。
// 演示数据保存在内存中，重启进程即恢复初始状态；不会写入任何真实数据库。
import {json, AppError} from './db';
import {DEMO_MODE} from './mode';

export const demoEnabled = () => DEMO_MODE;

const now = Date.now();
const DAY = 86_400_000;

type Dimension = {id: string; name: string; weight: number; rubric: string};
type Scorecard = {dimensions: Dimension[]; must_have: string[]; nice_to_have: string[]};
type DemoJob = {
  id: string; owner: string; name: string; department: string; location: string; level: string; notes: string;
  jd: string; profile: {summary: string; responsibilities: string[]; keywords: string[]}; version: number;
  confirmed: number; generation_status: string; generation_error?: string | null; created: number; updated: number;
};
type DemoCandidate = {
  id: string; job_id: string; owner: string; name: string; filename: string; status: string; score: number | null;
  version: number; error: string | null; error_code: string | null; retry_count: number; created: number; updated: number;
  analysis_started_at: number | null; analysis_completed_at: number | null; mime: string; resume_text: string;
  model: string; prompt_version: string; result: unknown | null;
};

const agentCard: Scorecard = {
  dimensions: [
    {id: 'd1', name: '产品规划与需求拆解', weight: 25, rubric: '能否把模糊业务目标拆成可交付的产品范围与迭代节奏。'},
    {id: 'd2', name: 'Agent / LLM 产品经验', weight: 30, rubric: '是否有大模型相关产品从 0 到 1 或规模化的真实落地经验。'},
    {id: 'd3', name: '跨团队协作与推动', weight: 20, rubric: '在算法、后端、设计多方协作中推动事情落地的能力。'},
    {id: 'd4', name: '数据驱动与效果评估', weight: 15, rubric: '是否建立可量化的效果指标并据此迭代。'},
    {id: 'd5', name: '技术理解力', weight: 10, rubric: '对 RAG、Prompt、工具调用等工程边界的理解深度。'},
  ],
  must_have: ['3 年以上产品经理经验', '有过 LLM 或 Agent 相关产品落地经验', '本科及以上学历'],
  nice_to_have: ['有大模型应用从 0 到 1 的经验', '熟悉 RAG 与 Prompt 工程', '有 B 端产品经验'],
};

const feCard: Scorecard = {
  dimensions: [
    {id: 'f1', name: '前端工程深度', weight: 30, rubric: '对渲染性能、构建链路与工程化的掌握程度。'},
    {id: 'f2', name: '复杂交互与体验实现', weight: 30, rubric: '能否独立完成高复杂度交互并保证体验质量。'},
    {id: 'f3', name: '技术方案设计', weight: 25, rubric: '是否具备架构选型与方案评审能力。'},
    {id: 'f4', name: '协作与影响力', weight: 15, rubric: '对团队规范、效率提升的实际贡献。'},
  ],
  must_have: ['5 年以上前端开发经验', '有大型中后台系统经验'],
  nice_to_have: ['有性能优化专项经验', '有开源贡献'],
};

const agentJd = `岗位职责
1. 负责企业级 AI Agent 产品的需求规划与版本迭代，输出清晰的产品方案与验收标准。
2. 与算法团队协作，定义 RAG、工具调用、多轮记忆等能力的产品边界与效果指标。
3. 建立 Prompt 与效果的回归评估机制，持续跟踪线上表现并驱动优化。
4. 主导跨团队协作，推动算法、后端、设计与交付团队按节奏交付。

任职要求
1. 本科及以上学历，3 年以上产品经理经验。
2. 有过 LLM 或 Agent 相关产品落地经验，理解大模型能力的实际边界。
3. 具备较强的逻辑拆解能力与数据敏感度。
4. 优秀的跨团队沟通与推动能力。

加分项
1. 有大模型应用从 0 到 1 的完整经验。
2. 熟悉 RAG 与 Prompt 工程。
3. 有 B 端产品经验。`;

const feJd = `岗位职责
1. 负责增长业务中后台与投放平台的前端架构设计与核心模块开发。
2. 主导前端性能优化专项，持续改善首屏与交互流畅度。
3. 参与技术方案评审，沉淀团队规范与可复用组件。
4. 与产品、设计、后端紧密协作，保证交付质量。

任职要求
1. 5 年以上前端开发经验，精通 React 与 TypeScript。
2. 有大型中后台系统经验，理解复杂状态管理。
3. 具备独立完成技术方案设计的能力。

加分项
1. 有性能优化专项经验。
2. 有开源贡献。`;

const agentResume = {
  chen: `陈嘉禾
求职意向：AI 产品经理

工作经历
2021.06 - 至今  杭州云智科技有限公司  AI 产品负责人
· 主导企业知识库智能问答产品从 0 到 1 落地，上线 8 个月内服务 320 家企业客户。
· 设计基于 RAG 的检索增强方案，将答案准确率从 61% 提升到 87%。
· 建立 Prompt 版本管理与效果回归机制，线上答非所问率下降 42%。

2018.03 - 2021.05  上海数联信息技术有限公司  产品经理
· 负责 B 端数据分析平台的需求规划，累计交付 14 个版本。
· 推动跨 4 个团队的协作流程改造，需求平均交付周期缩短 30%。

教育背景
2014.09 - 2018.06  同济大学  软件工程  本科

技能
Prompt 工程、RAG、SQL、Axure、数据分析`,
  lin: `林雨桐
求职意向：AI 产品经理

工作经历
2022.03 - 至今  上海智言科技有限公司  高级产品经理
· 负责智能客服 Agent 产品，完成意图识别与多轮对话流程设计，人工转接率下降 26%。
· 主导 Prompt 调优专项，收集 1200 条真实会话样本用于效果回归。

2019.07 - 2022.02  南京云雀软件有限公司  产品经理
· 负责企业 IM 与工单系统需求规划，服务内部 4000+ 员工。

教育背景
2015.09 - 2019.06  东南大学  信息管理与信息系统  本科

技能
产品需求文档、SQL、数据分析、Prompt 工程`,
  wang: `王思远
求职意向：AI 产品经理

工作经历
2020.08 - 至今  深圳启元数据有限公司  产品经理
· 负责数据看板与指标平台，累计交付 9 个版本，覆盖 6 条业务线。
· 参与大模型问答助手的需求调研，输出竞品分析报告。

2017.06 - 2020.07  广州联创科技有限公司  产品助理
· 协助完成需求整理与原型设计。

教育背景
2013.09 - 2017.06  中山大学  管理学  本科

技能
需求分析、原型设计、SQL`,
  zhao: `赵明轩
求职意向：产品经理

工作经历
2023.02 - 至今  成都易创网络有限公司  产品经理
· 负责会员增长活动配置后台，完成活动模板化配置。
· 参与 AI 文案生成功能的调研与试用。

2021.07 - 2023.01  成都天启科技有限公司  运营专员
· 负责活动运营与数据复盘。

教育背景
2017.09 - 2021.06  西南财经大学  市场营销  本科

技能
活动运营、Excel、基础 SQL`,
  zhou: `周梦琪
求职意向：产品助理

工作经历
2024.03 - 至今  武汉光谷信息技术有限公司  产品助理
· 跟进需求文档整理与会议纪要，协助完成版本验收。

2023.06 - 2024.02  武汉云帆科技有限公司  实习产品助理
· 协助完成用户反馈分类整理。

教育背景
2021.09 - 2025.06  湖北大学  电子商务  本科（在读）

技能
Axure、Office`,
  sun: `孙浩然
（该文件解析失败，未能提取有效文本内容）`,
  wu: `吴子豪
求职意向：高级前端工程师

工作经历
2018.04 - 至今  北京字节方舟科技有限公司  前端技术专家
· 主导投放平台前端架构升级，首屏加载时间从 3.2s 降至 1.1s。
· 设计统一状态管理方案，覆盖 40+ 页面，代码重复率下降 35%。
· 主导前端性能专项，建立上线前后性能基线与告警。

2015.07 - 2018.03  北京云图软件有限公司  前端工程师
· 参与中后台系统开发与组件库建设。

教育背景
2011.09 - 2015.06  北京邮电大学  计算机科学与技术  本科

技能
React、TypeScript、构建优化、性能调优`,
  zheng: `郑欣然
求职意向：前端工程师

工作经历
2020.09 - 至今  天津海河数科有限公司  前端工程师
· 负责数据中台前端开发，完成 20+ 业务页面交付。
· 参与组件库维护与样式规范统一。

2019.03 - 2020.08  天津明远科技有限公司  初级前端
· 负责管理后台页面开发。

教育背景
2015.09 - 2019.06  天津大学  软件工程  本科

技能
React、TypeScript、CSS`,
};

const initialJobs: DemoJob[] = [
  {
    id: 'job-agent-pm', owner: 'demo', name: 'Agent 产品经理', department: 'AI 产品部', location: '上海', level: 'P6', notes: '',
    jd: agentJd,
    profile: {
      summary: '负责企业级 AI Agent 产品的规划与落地，需要在 LLM 能力边界、效果评估与跨团队推动之间取得平衡。',
      responsibilities: ['输出 AI Agent 产品方案与验收标准', '定义 RAG 与工具调用的产品边界', '建立 Prompt 与效果回归机制', '主导跨团队协作交付'],
      keywords: ['AI Agent', 'LLM 产品', 'RAG', 'Prompt 工程', '效果评估', 'B 端产品'],
    },
    version: 2, confirmed: 1, generation_status: 'completed', created: now - 6 * DAY, updated: now - 2 * 3600_000,
  },
  {
    id: 'job-fe-lead', owner: 'demo', name: '高级前端工程师', department: '增长技术部', location: '北京', level: 'P7', notes: '',
    jd: feJd,
    profile: {
      summary: '负责增长业务中后台与投放平台的前端架构与核心开发，强调性能优化与工程规范沉淀。',
      responsibilities: ['前端架构设计与核心模块开发', '主导性能优化专项', '参与技术方案评审', '沉淀团队规范与组件'],
      keywords: ['React', 'TypeScript', '性能优化', '中后台', '前端架构'],
    },
    version: 1, confirmed: 1, generation_status: 'completed', created: now - 3 * DAY, updated: now - 26 * 3600_000,
  },
];

function agentResult(spec: {
  scores: number[]; strengths: string[]; risks: string[]; unknowns: string[]; questions: string[];
  mustEvidence: string[]; confidence: number; reasons: string[];
}) {
  const dims = agentCard.dimensions.map((d, i) => ({id: d.id, score: spec.scores[i], reason: spec.reasons[i], evidence: [] as string[]}));
  return {dimensions: dims, strengths: spec.strengths, risks: spec.risks, unknowns: spec.unknowns, questions: spec.questions, mustEvidence: spec.mustEvidence, confidence: spec.confidence};
}

const agentResults: Record<string, ReturnType<typeof agentResult>> = {
  chen: agentResult({
    scores: [23, 28, 17, 14, 10],
    strengths: ['有完整的企业级 LLM 应用 0 到 1 落地经验', '效果评估体系完整，能用量化指标驱动迭代', '具备 RAG 与 Prompt 工程的实操深度'],
    risks: ['缺少面向海量用户的产品经验', '团队管理规模在简历中表述不明确'],
    unknowns: ['是否直接管理过产品团队', '对多轮工具调用工程边界的理解程度'],
    questions: ['知识库问答从 0 到 1 时，你如何定义第一版的成功标准？', 'RAG 准确率从 61% 提升到 87%，最大的单点改进是什么？', '你如何协调算法、后端与设计团队推进跨团队需求？'],
    mustEvidence: ['2018.03 - 2021.05  上海数联信息技术有限公司  产品经理', '主导企业知识库智能问答产品从 0 到 1 落地', '同济大学  软件工程  本科'],
    confidence: 0.88,
    reasons: ['有从 0 到 1 与多版本迭代的完整规划经验', '企业级知识库问答产品已规模化落地', '有明确的跨团队流程改造成果', '以准确率等指标驱动迭代', '对 RAG 方案有实际设计参与'],
  }),
  lin: agentResult({
    scores: [20, 24, 16, 13, 8],
    strengths: ['有智能客服 Agent 的多轮对话设计经验', '具备 Prompt 调优与样本回归的实操', '需求交付节奏稳定'],
    risks: ['缺少完整 0 到 1 的产品主导经历', '效果指标的量化口径不够清晰'],
    unknowns: ['是否独立负责过产品立项与目标设定', '对 RAG 检索链路的理解深度'],
    questions: ['人工转接率下降 26% 的过程中，你如何排除其他因素影响？', '1200 条会话样本的选取标准是什么？'],
    mustEvidence: ['2022.03 - 至今  上海智言科技有限公司  高级产品经理', '负责智能客服 Agent 产品', '东南大学  信息管理与信息系统  本科'],
    confidence: 0.82,
    reasons: ['有较完整的需求规划与版本交付经验', '智能客服 Agent 已上线运行', '推动过跨团队协作但规模有限', '有样本回归意识但指标口径偏弱', '理解 Prompt 调优但工程边界表述较少'],
  }),
  wang: agentResult({
    scores: [19, 15, 15, 13, 6],
    strengths: ['多业务线数据产品交付经验扎实', '有参与大模型问答需求的调研经历'],
    risks: ['LLM 相关经验停留在调研阶段，缺少落地', '未体现效果评估机制的建设'],
    unknowns: ['是否有实际推动大模型功能上线的经验', '跨团队推动中的具体角色'],
    questions: ['竞品分析报告中最关键的结论是什么？是否影响了产品决策？', '9 个版本中你独立决策的部分有哪些？'],
    mustEvidence: ['2020.08 - 至今  深圳启元数据有限公司  产品经理', '参与大模型问答助手的需求调研，输出竞品分析报告', '中山大学  管理学  本科'],
    confidence: 0.75,
    reasons: ['交付经验充分但复杂度偏中等', '大模型经历以调研为主，未落地', '有跨业务线协作经验', '数据产品背景带来指标意识', '技术理解以调研为主'],
  }),
  zhao: agentResult({
    scores: [16, 8, 13, 11, 4],
    strengths: ['有后台工具类产品经验', '对 AI 文案功能有初步实践'],
    risks: ['产品经验年限不足 3 年', '缺少 LLM 产品落地经验', '教育背景为市场营销，技术理解待验证'],
    unknowns: ['是否满足 3 年经验硬性要求', '是否有独立负责模块的经历'],
    questions: ['活动模板化配置解决了什么原本的痛点？', '你对 AI 文案生成的实际效果如何评估？'],
    mustEvidence: ['2023.02 - 至今  成都易创网络有限公司  产品经理', '参与 AI 文案生成功能的调研与试用', '西南财经大学  市场营销  本科'],
    confidence: 0.7,
    reasons: ['产品经验以活动配置类为主，复杂度有限', 'AI 相关仅停留在调研与试用', '跨团队协作经历较浅', '数据复盘偏运营口径', '技术理解证据不足'],
  }),
  zhou: agentResult({
    scores: [11, 4, 10, 8, 3],
    strengths: ['有需求文档与版本验收的协助经验', '态度记录完整'],
    risks: ['岗位为产品助理，与独立负责产品的要求差距明显', '仍在校就读，工作经验不足 1 年'],
    unknowns: ['能否独立承担产品线目标', '毕业时间与到岗安排'],
    questions: ['你参与过的版本中，哪一个环节由你主导推动？'],
    mustEvidence: ['2024.03 - 至今  武汉光谷信息技术有限公司  产品助理', '协助完成用户反馈分类整理', '湖北大学  电子商务  本科（在读）'],
    confidence: 0.66,
    reasons: ['独立规划经验不足', '无 LLM 产品经验', '协作以协助角色为主', '数据意识较初步', '技术理解证据不足'],
  }),
};

function mustHaveFor(evidence: string[], confidence: number) {
  return agentCard.must_have.map((req, i) => ({
    requirement: req,
    status: evidence[i] ? 'met' : 'unknown',
    evidence: evidence[i] ?? '',
  })).map(x => ({...x, confidence}));
}

function evalFor(key: keyof typeof agentResults, score: number, level: string, spec: ReturnType<typeof agentResult>) {
  return {
    candidate_profile: {name: '', education: [], experience: [], projects: [], skills: [], achievements: []},
    dimension_scores: spec.dimensions,
    strengths: spec.strengths,
    risks: spec.risks,
    must_have: mustHaveFor(spec.mustEvidence, spec.confidence),
    unknowns: spec.unknowns,
    interview_questions: spec.questions,
    confidence: spec.confidence,
    total_score: score,
    match_level: level,
  };
}

const initialCandidates: DemoCandidate[] = [
  {
    id: 'cand-chen', job_id: 'job-agent-pm', owner: 'demo', name: '陈嘉禾', filename: '陈嘉禾-AI产品经理.pdf',
    status: 'completed', score: 92, version: 2, error: null, error_code: null, retry_count: 0,
    created: now - 5 * DAY, updated: now - 4 * DAY, analysis_started_at: now - 5 * DAY + 60_000,
    analysis_completed_at: now - 5 * DAY + 60_000 + 38_000, mime: 'application/pdf', resume_text: agentResume.chen,
    model: 'deepseek-flash', prompt_version: 'resume-v1.1', result: evalFor('chen', 92, 'high', agentResults.chen),
  },
  {
    id: 'cand-lin', job_id: 'job-agent-pm', owner: 'demo', name: '林雨桐', filename: '林雨桐-高级产品经理.pdf',
    status: 'completed', score: 84, version: 2, error: null, error_code: null, retry_count: 1,
    created: now - 4 * DAY, updated: now - 3 * DAY, analysis_started_at: now - 4 * DAY + 90_000,
    analysis_completed_at: now - 4 * DAY + 90_000 + 44_000, mime: 'application/pdf', resume_text: agentResume.lin,
    model: 'deepseek-flash', prompt_version: 'resume-v1.1', result: evalFor('lin', 84, 'recommended', agentResults.lin),
  },
  {
    id: 'cand-wang', job_id: 'job-agent-pm', owner: 'demo', name: '王思远', filename: '王思远-产品经理.docx',
    status: 'completed', score: 76, version: 2, error: null, error_code: null, retry_count: 0,
    created: now - 4 * DAY, updated: now - 4 * DAY, analysis_started_at: now - 4 * DAY + 30_000,
    analysis_completed_at: now - 4 * DAY + 30_000 + 51_000, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    resume_text: agentResume.wang, model: 'deepseek-flash', prompt_version: 'resume-v1.1', result: evalFor('wang', 76, 'recommended', agentResults.wang),
  },
  {
    id: 'cand-zhao', job_id: 'job-agent-pm', owner: 'demo', name: '赵明轩', filename: '赵明轩-产品经理.pdf',
    status: 'completed', score: 63, version: 2, error: null, error_code: null, retry_count: 0,
    created: now - 3 * DAY, updated: now - 3 * DAY, analysis_started_at: now - 3 * DAY + 20_000,
    analysis_completed_at: now - 3 * DAY + 20_000 + 36_000, mime: 'application/pdf', resume_text: agentResume.zhao,
    model: 'deepseek-flash', prompt_version: 'resume-v1.1', result: evalFor('zhao', 63, 'review', agentResults.zhao),
  },
  {
    id: 'cand-zhou', job_id: 'job-agent-pm', owner: 'demo', name: '周梦琪', filename: '周梦琪-产品助理.pdf',
    status: 'completed', score: 48, version: 2, error: null, error_code: null, retry_count: 0,
    created: now - 2 * DAY, updated: now - 2 * DAY, analysis_started_at: now - 2 * DAY + 15_000,
    analysis_completed_at: now - 2 * DAY + 15_000 + 29_000, mime: 'application/pdf', resume_text: agentResume.zhou,
    model: 'deepseek-flash', prompt_version: 'resume-v1.1', result: evalFor('zhou', 48, 'low', agentResults.zhou),
  },
  {
    id: 'cand-sun', job_id: 'job-agent-pm', owner: 'demo', name: '孙浩然', filename: '孙浩然-产品经理.pdf',
    status: 'failed', score: null, version: 2, error: '简历文件损坏，未能提取到有效文本；原文件已保留，可重新分析。',
    error_code: 'PARSE_FAILED', retry_count: 2, created: now - 2 * DAY, updated: now - 2 * DAY + 5 * 60_000,
    analysis_started_at: now - 2 * DAY + 60_000, analysis_completed_at: null, mime: 'application/pdf',
    resume_text: agentResume.sun, model: 'deepseek-flash', prompt_version: 'resume-v1.1', result: null,
  },
  {
    id: 'cand-wu', job_id: 'job-fe-lead', owner: 'demo', name: '吴子豪', filename: '吴子豪-前端技术专家.pdf',
    status: 'completed', score: 88, version: 1, error: null, error_code: null, retry_count: 0,
    created: now - 2 * DAY, updated: now - 2 * DAY, analysis_started_at: now - 2 * DAY + 40_000,
    analysis_completed_at: now - 2 * DAY + 40_000 + 47_000, mime: 'application/pdf', resume_text: agentResume.wu,
    model: 'deepseek-flash', prompt_version: 'resume-v1.1',
    result: {
      candidate_profile: {name: '吴子豪', education: [], experience: [], projects: [], skills: [], achievements: []},
      dimension_scores: [
        {id: 'f1', score: 27, reason: '架构升级与构建优化经验明确', evidence: ['主导投放平台前端架构升级，首屏加载时间从 3.2s 降至 1.1s。']},
        {id: 'f2', score: 26, reason: '处理过复杂状态与多页面交互', evidence: ['设计统一状态管理方案，覆盖 40+ 页面，代码重复率下降 35%。']},
        {id: 'f3', score: 23, reason: '有方案设计与性能基线建设能力', evidence: ['主导前端性能专项，建立上线前后性能基线与告警。']},
        {id: 'f4', score: 12, reason: '对团队规范有实际沉淀', evidence: ['设计统一状态管理方案，覆盖 40+ 页面，代码重复率下降 35%。']},
      ],
      strengths: ['性能优化有明确量化结果', '大型中后台架构经验扎实', '具备技术方案设计与规范沉淀能力'],
      risks: ['缺少开源贡献证明', '管理经验在简历中未体现'],
      must_have: [
        {requirement: '5 年以上前端开发经验', status: 'met', evidence: '2015.07 - 2018.03  北京云图软件有限公司  前端工程师'},
        {requirement: '有大型中后台系统经验', status: 'met', evidence: '设计统一状态管理方案，覆盖 40+ 页面，代码重复率下降 35%。'},
      ],
      unknowns: ['是否带过小团队', '对新技术选型的话语权'],
      interview_questions: ['首屏从 3.2s 降到 1.1s，你最先动的是哪一环？', '统一状态管理方案如何兼顾老页面迁移成本？'],
      confidence: 0.86, total_score: 88, match_level: 'high',
    },
  },
  {
    id: 'cand-zheng', job_id: 'job-fe-lead', owner: 'demo', name: '郑欣然', filename: '郑欣然-前端工程师.docx',
    status: 'completed', score: 71, version: 1, error: null, error_code: null, retry_count: 0,
    created: now - DAY, updated: now - DAY, analysis_started_at: now - DAY + 25_000,
    analysis_completed_at: now - DAY + 25_000 + 41_000, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    resume_text: agentResume.zheng, model: 'deepseek-flash', prompt_version: 'resume-v1.1',
    result: {
      candidate_profile: {name: '郑欣然', education: [], experience: [], projects: [], skills: [], achievements: []},
      dimension_scores: [
        {id: 'f1', score: 22, reason: '常规业务开发经验充足，缺少深度优化案例', evidence: ['负责数据中台前端开发，完成 20+ 业务页面交付。']},
        {id: 'f2', score: 21, reason: '页面交付经验稳定，复杂度中等', evidence: ['参与组件库维护与样式规范统一。']},
        {id: 'f3', score: 17, reason: '技术方案以参与为主', evidence: ['参与组件库维护与样式规范统一。']},
        {id: 'f4', score: 11, reason: '有规范统一的实际参与', evidence: ['参与组件库维护与样式规范统一。']},
      ],
      strengths: ['业务页面交付经验稳定', '有组件库与样式规范参与经验'],
      risks: ['缺少性能优化专项与架构主导经验', '技术深度证据偏少'],
      must_have: [
        {requirement: '5 年以上前端开发经验', status: 'met', evidence: '2019.03 - 2020.08  天津明远科技有限公司  初级前端'},
        {requirement: '有大型中后台系统经验', status: 'met', evidence: '负责数据中台前端开发，完成 20+ 业务页面交付。'},
      ],
      unknowns: ['是否独立做过技术选型', '对构建链路的掌握程度'],
      interview_questions: ['20+ 业务页面中，哪一类最难维护？你做了什么改进？'],
      confidence: 0.78, total_score: 71, match_level: 'recommended',
    },
  },
];

type DemoStore = {jobs: DemoJob[]; candidates: DemoCandidate[]};
const globalStore = globalThis as unknown as {__xiaofengDemoStores?: Record<string, DemoStore>};

/** 从 Cookie 读取登录邮箱，作为演示数据隔离的 key；未登录时归入本地默认账号。 */
export function demoOwner(req: Request): string {
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/(?:^|; )xf_user=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : 'local@demo';
}

/** 每个登录邮箱拥有独立且初始为空的数据，需要自己创建岗位、上传简历。 */
function store(owner: string): DemoStore {
  const stores = (globalStore.__xiaofengDemoStores ??= {});
  stores[owner] ??= {jobs: [], candidates: []};
  return stores[owner];
}

/** 把内置示例数据写入当前账号，供「载入示例数据」按钮使用。 */
function seedSampleData(s: DemoStore, owner: string) {
  s.jobs = initialJobs.map(j => ({...j, owner, profile: {...j.profile}}));
  s.candidates = initialCandidates.map(c => ({...c, owner}));
}

/** 用户新建的岗位没有真实 AI 生成过程，这里给一套通用评分卡。 */
const genericCard: Scorecard = {
  dimensions: [
    {id: 'g1', name: '岗位相关经验', weight: 30, rubric: '过往经历与岗位职责的匹配程度。'},
    {id: 'g2', name: '核心技能匹配', weight: 25, rubric: '简历中体现的关键技能是否覆盖岗位要求。'},
    {id: 'g3', name: '成果与影响力', weight: 20, rubric: '是否有可验证的成果或量化结果。'},
    {id: 'g4', name: '协作与推动', weight: 15, rubric: '跨团队协作与推进落地的经历。'},
    {id: 'g5', name: '成长与学习', weight: 10, rubric: '职业发展路径与学习能力。'},
  ],
  must_have: ['满足岗位要求的基本年限', '具备岗位核心技能'],
  nice_to_have: ['有相关行业背景', '有从 0 到 1 的项目经验'],
};

const cardOf = (jobId: string): Scorecard => jobId === 'job-fe-lead' ? feCard : jobId === 'job-agent-pm' ? agentCard : genericCard;

/** 演示模式：上传的简历在短暂延迟后自动「分析完成」，用岗位评分卡生成一份模拟评价。 */
const ANALYSIS_DELAY_MS = 4000;

function simulateResult(card: Scorecard) {
  // 按维度的 55%–95% 生成分数，保证每个分项都不超过权重、总分落在合理区间。
  const ratio = 0.55 + Math.random() * 0.4;
  const dimension_scores = card.dimensions.map(d => ({
    id: d.id,
    score: Math.max(0, Math.min(d.weight, Math.round(d.weight * ratio))),
    evidence: [] as string[],
    reason: '演示模式：该分项由模拟生成，未基于真实简历内容。',
  }));
  const total = dimension_scores.reduce((sum, x) => sum + x.score, 0);
  return {
    candidate_profile: {name: '', education: [], experience: [], projects: [], skills: [], achievements: []},
    dimension_scores,
    strengths: ['演示数据：接入真实 DeepSeek 后会基于简历原文给出优势'],
    risks: ['演示数据：未做真实性核验'],
    must_have: card.must_have.map(requirement => ({requirement, status: 'unknown', evidence: ''})),
    unknowns: ['演示模式无法从简历中提取具体信息'],
    interview_questions: [],
    confidence: 0.5,
    total_score: total,
    match_level: total >= 85 ? 'high' : total >= 70 ? 'recommended' : total >= 55 ? 'review' : 'low',
  };
}

/** 把等待中的候选人结算为已完成，模拟后台分析的耗时过程。 */
function settleRunning(s: DemoStore) {
  const current = Date.now();
  for (const c of s.candidates) {
    if (['waiting', 'parsing', 'scoring'].includes(c.status) && current - c.created >= ANALYSIS_DELAY_MS) {
      const result = simulateResult(cardOf(c.job_id));
      c.result = result;
      c.status = 'completed';
      c.score = result.total_score;
      c.analysis_completed_at = current;
      c.updated = current;
    }
  }
}

function jobSummary(j: DemoJob, all: DemoCandidate[]) {
  const rows = all.filter(c => c.job_id === j.id);
  return {
    ...j,
    count: rows.length,
    completed: rows.filter(c => c.status === 'completed').length,
    high: rows.filter(c => c.status === 'completed' && (c.score ?? 0) >= 85).length,
    today: rows.filter(c => c.created >= now - DAY).length,
  };
}

export async function demoRequest(req: Request): Promise<Response> {
  try {
    if (!isAllowedRequestOrigin(req)) return json({ error: '无效的请求来源' }, 403);
    const parts = new URL(req.url).pathname.slice(5).split('/');
    const [kind, id, action] = parts;
    const owner = demoOwner(req);
    const s = store(owner);
    // 每次请求先结算到期的分析任务，模拟后台处理进度。
    settleRunning(s);

    if (kind === 'status' && req.method === 'GET') return json({ai_configured: true, demo: true});

    if (kind === 'demo-seed' && req.method === 'POST') {
      seedSampleData(s, owner);
      return json({ok: true, jobs: s.jobs.length, candidates: s.candidates.length});
    }

    if (kind === 'documents' && req.method === 'POST') {
      const {fileName} = await req.json();
      return json({
        text: `演示模式：已模拟解析 ${fileName || '文件'}。\n\n岗位职责\n1. 负责业务方向的产品规划与版本迭代，输出清晰的产品方案与验收标准。\n2. 与设计、研发协作推进需求落地并跟踪效果。\n\n任职要求\n1. 本科及以上学历，3 年以上相关经验。\n2. 具备清晰的逻辑拆解能力与跨团队沟通能力。\n\n（正式环境会解析你上传的真实 JD 文件。）`,
      });
    }

    if (kind === 'settings' && id === 'ai') {
      const settings = {
        configured: false, masked_key: null, job_model: 'deepseek-v4-pro', resume_model: 'deepseek-flash',
        version: 1, updated_at: now, provider: 'deepseek', endpoint: 'https://api.deepseek.com',
      };
      if (req.method === 'GET' && !action) return json(settings);
      if (req.method === 'POST' && action === 'test') return json({ok: true, checks: [{model: 'deepseek-v4-pro', latency_ms: 412}, {model: 'deepseek-flash', latency_ms: 268}]});
      if (req.method === 'PUT' || req.method === 'DELETE') return json(settings);
    }

    if (kind === 'usage' && req.method === 'GET') {
      const candidates = s.candidates.length;
      return json({owner, jobs: s.jobs.length, job_limit: 10, candidates, candidate_limit: 200, ai_requests: 27 + candidates, ai_limit: 1000});
    }

    if (kind === 'jobs' && !id && req.method === 'GET') return json(s.jobs.map(j => jobSummary(j, s.candidates)));

    if (kind === 'jobs' && !id && req.method === 'POST') {
      const body: any = await req.json();
      const created: DemoJob = {
        id: 'job-' + crypto.randomUUID().slice(0, 8), owner, name: body.name, department: body.department ?? '',
        location: body.location ?? '', level: body.level ?? '', notes: body.notes ?? '', jd: body.jd,
        profile: {
          summary: `演示模式：以下为「${body.name}」的岗位画像示例。接入真实 DeepSeek 后，这里会由 AI 从你的 JD 中提取。`,
          responsibilities: ['负责该方向的产品/技术规划与版本迭代', '与上下游团队协作推进需求落地', '跟踪上线效果并持续优化'],
          keywords: ['岗位画像', '需求规划', '跨团队协作', '效果跟踪'],
        },
        version: 1, confirmed: 0, generation_status: 'completed', created: Date.now(), updated: Date.now(),
      };
      s.jobs.unshift(created);
      return json({id: created.id}, 201);
    }

    if (kind === 'jobs' && id) {
      const job = s.jobs.find(j => j.id === id);
      if (!job) throw new AppError('岗位不存在', 404);
      if (req.method === 'GET' && !action) return json({...job, scorecard: cardOf(job.id)});
      if (action === 'candidates' && req.method === 'GET') {
        return json(s.candidates.filter(c => c.job_id === id));
      }
      if (action === 'metrics' && req.method === 'GET') {
        const rows = s.candidates.filter(c => c.job_id === id);
        const completed = rows.filter(c => c.status === 'completed');
        const failed = rows.filter(c => c.status === 'failed');
        const spans = completed.map(c => (c.analysis_completed_at ?? 0) - (c.analysis_started_at ?? 0));
        return json({
          counts: {
            uploaded: rows.length, completed: completed.length, failed: failed.length,
            average_ms: spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : 0,
          },
          usage: {requests: completed.length * 2 + failed.length * 2, average_tokens: 8420, total_estimated_cost: 0.0412, average_estimated_cost: 0.0022},
          review: null,
        });
      }
      if (action === 'ranking' && req.method === 'POST') {
        const body: any = await req.json();
        const ids: string[] = Array.isArray(body.candidateIds) ? body.candidateIds : [];
        return json({top5_overlap: 0.8, top10_overlap: 0.9, sample_size: ids.length});
      }
      if (action === 'scorecard' && req.method === 'PUT') {
        const body: any = await req.json();
        job.confirmed = 1; job.version = (job.version ?? 1) + 1; job.updated = Date.now();
        return json({version: job.version});
      }
      if (action === 'retry' && req.method === 'POST') { job.generation_status = 'completed'; return json({ok: true}, 202); }
      if (req.method === 'DELETE' && !action) {
        s.candidates = s.candidates.filter(x => x.job_id !== id);
        s.jobs = s.jobs.filter(x => x.id !== id);
        return json({ok: true});
      }
      if (req.method === 'PUT' && !action) { job.updated = Date.now(); return json({ok: true}, 202); }
    }

    if (kind === 'candidates' && !id && req.method === 'POST') {
      const body: any = await req.json();
      const job = s.jobs.find(j => j.id === body.jobId);
      if (!job) throw new AppError('岗位不存在', 404);
      const name = String(body.fileName ?? '未命名').replace(/\.(pdf|docx)$/i, '').split('-')[0];
      const created: DemoCandidate = {
        id: 'cand-' + crypto.randomUUID().slice(0, 8), job_id: job.id, owner, name, filename: String(body.fileName ?? ''),
        status: 'scoring', score: null, version: job.version, error: null, error_code: null, retry_count: 0,
        created: Date.now(), updated: Date.now(), analysis_started_at: Date.now(), analysis_completed_at: null,
        mime: /\.pdf$/i.test(String(body.fileName)) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        resume_text: `演示模式：已接收「${String(body.fileName ?? '简历')}」。接入真实解析服务后，这里会显示从文档提取的文本。`,
        model: 'deepseek-flash', prompt_version: 'resume-v1.1',
        result: null,
      };
      s.candidates.unshift(created);
      return json({id: created.id, status: 'scoring'}, 202);
    }

    if (kind === 'candidates' && id) {
      const c = s.candidates.find(x => x.id === id);
      if (!c) throw new AppError('候选人不存在', 404);
      if (req.method === 'DELETE' && !action) {
        s.candidates = s.candidates.filter(x => x.id !== id);
        return json({ok: true});
      }
      if (action === 'retry' && req.method === 'POST') { c.status = 'completed'; c.error = null; return json({ok: true}, 202); }
      if (action === 'file' && req.method === 'GET') return json({error: '演示模式不提供原始文件下载'}, 404);
      if (req.method === 'GET' && !action) {
        const job = s.jobs.find(j => j.id === c.job_id);
        return json({...c, scorecard_id: job ? job.id + '-card' : null, scorecard: cardOf(c.job_id), profile: null});
      }
    }

    return json({error: '演示模式暂不支持该接口：' + parts.join('/')}, 404);
  } catch (e) {
    if (e instanceof AppError) return json({error: e.message}, e.status);
    console.error('demo request failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    return json({error: '演示模式发生错误'}, 500);
  }
}
