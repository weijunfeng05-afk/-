// 本地运行模式（无需 Supabase / PostgreSQL / Netlify 后台任务）的统一开关。
//
// NEXT_PUBLIC_AI_MODE 取值：
//   demo —— 内置模拟数据与模拟评分，仅用于预览界面，不调用大模型；
//   real —— 真实调用 DeepSeek 大模型，数据按登录邮箱隔离保存在内存（重启后清空）。
// 未设置 AI_MODE 且 NEXT_PUBLIC_DEMO_MODE=true 时，按 demo 兼容处理（旧配置）。
const AI_MODE = process.env.NEXT_PUBLIC_AI_MODE as 'demo' | 'real' | undefined;

/** 真实 AI 本地模式：真实调用 DeepSeek。 */
export const REAL_AI_MODE = AI_MODE === 'real';

/** 演示模式：内置模拟数据与模拟评分。 */
export const DEMO_MODE = AI_MODE === 'demo' || (AI_MODE !== 'real' && process.env.NEXT_PUBLIC_DEMO_MODE === 'true');

/** 任意本地模式：都不连接 Supabase 与 PostgreSQL。 */
export const LOCAL_MODE = DEMO_MODE || REAL_AI_MODE;
