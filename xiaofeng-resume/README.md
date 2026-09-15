# 小锋牌简历 V1.1 Beta

技术栈：Next.js 16 + Netlify Functions + Supabase Auth / PostgreSQL / 私有 Storage。
本目录是独立应用根目录，来自用户指定的 `xiaofeng-resume-supabase-latest-source.zip`。
外层旧实现已备份到 `.qa/deployment-backup`，根目录部署配置已指向本应用。部署时请使用本目录或根目录的 Netlify 配置。

## 开始

Node.js 22.13+；pnpm 11.19。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

复制 `.env.example` 为 `.env.local` 并填写自己的配置。不要提交真实密钥。
生产部署顺序、迁移、邀请生成、回滚和验收见 [部署说明](docs/NETLIFY-SUPABASE.md)。

## 已实现

- 邮箱专属、单次有效、可过期的邀请码；数据库 Auth 触发器阻止绕过页面注册。
- 平台 DeepSeek Key 默认可用，个人密钥仍加密保存；每用户默认 10 岗位、200 简历、1000 AI 请求，重试也计入请求额度。
- 浏览器直传私有 Storage；上传元数据接口幂等；原简历使用 60 秒签名链接查看。
- 岗位画像和简历评分都通过 Netlify Background Functions 执行。定时任务每分钟恢复队列，不依赖页面存活。
- 数据库持久并发名额，每用户最多 3 个分析任务，包括岗位生成与重新评分；失败自动重试最多 2 次，可手动重试。
- 评分卡变更确认、原子版本更新、旧结果清空与旧 worker 隔离。JD 可重新生成，确认新标准后再评分。
- 批量直传、状态进度、失败原因、前台按需刷新、证据与未知项、候选人分数及置信度提示。
- 内测额度、岗位成功率/耗时/Token/成本统计，人工 Top5 / Top10 排序对比快照。
- 业务表按用户隔离；浏览器只能读取自己的业务数据，可信服务端才能写评分与额度。

## 交付边界

本地自动测试使用真实 PostgreSQL 语义的 PGlite 和模拟 AI / Storage 响应；不能证明真实 Netlify、Supabase 或 DeepSeek 已联通。
上线前必须完成部署说明中的云端验收。未自动创建真实邀请码、消耗真实模型额度、邀请外部 HR 或发布站点。
静态检查保留原始 JSON / 数据库动态类型的 `no-explicit-any` 警告；其他 lint 错误仍阻止检查通过。
扫描型 PDF 暂不做 OCR，解析失败会保留原文件并给出说明。
成本为 USD 估算快照，不是账单；价格和折扣变化后需更新 `lib/ai/client.ts`。

不包含支付、团队权限、ATS、招聘平台集成或自动邮件邀请。
