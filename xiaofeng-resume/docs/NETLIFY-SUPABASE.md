# V1.1 Beta 部署与验收

## 部署前准备

1. 使用独立源码包根目录作为 Netlify 项目根目录。如果从外层工作区部署，必须明确把应用根目录设为 `xiaofeng-resume`，不能使用外层旧项目的部署配置。
2. 备份已有 Supabase 数据库及 Storage。暂停旧站点写入，再按文件名顺序执行迁移。
3. 新库执行 `001_multiuser.sql` 至 `009_atomic_completion.sql`；已使用原版 `001_multiuser.sql` 的库只执行 `002` 至 `009`。迁移不是重复执行脚本，请记录已执行文件。
4. 每个迁移自带事务。全部迁移完成再发布新应用。不要在新权限模型下继续运行旧 API。

`002` 创建仅供数据库连接切换使用的 `app_backend` 角色。`DATABASE_URL` 需要使用有权 SET ROLE app_backend 的服务端数据库角色（默认 postgres）；不能把此连接串给浏览器。
业务 SQL 每个事务设置当前用户 JWT claims 后 SET LOCAL ROLE app_backend，再由 RLS 过滤；连接池 max=1、prepare=false。

## 环境变量

Netlify Build 和 Functions 均需要公开 Supabase URL / publishable key。
以下变量仅用于服务端：

- `DATABASE_URL`：Supabase transaction pooler URL，通常为 6543 端口。
- `SUPABASE_SERVICE_ROLE_KEY`：后台下载简历、定位任务所属用户、定时恢复；绝不能使用 NEXT_PUBLIC 前缀。
- `DEEPSEEK_API_KEY`：平台内测密钥。
- `API_KEY_ENCRYPTION_SECRET`：32 字节随机数据的 Base64，用于个人密钥 AES-GCM；保存稳定备份。
- `BACKGROUND_SECRET`：至少 32 字节随机值，用于 API / 定时函数内部投递鉴权。
- `SITE_URL`：正式站点 HTTPS 源站，Netlify 存在 `URL` 时优先使用平台 URL。

背景函数名：`analyze-candidate-background`、`generate-job-background`。
定时函数：`recover-analysis`，每分钟恢复超时租约、重试暂时失败任务并按用户剩余并发名额公平投递。
Netlify Scheduled Functions 只在已发布的生产站点调度；部署预览不会自动恢复队列。
检查 Netlify 账户支持 Background Functions；其最长运行时间为 15 分钟，本实现每次 AI 请求限时 90 秒。

## Supabase Auth

配置站点 URL 和允许回调 `/auth/callback`，开启邮箱验证。
`002` 的 Auth 插入触发器在数据库事务中验证并消费邮箱专属邀请码，不需要另外启用 Auth Hook。
所有新账号都必须有有效邀请码；旧账号保留登录能力，默认获得内测额度。

在 SQL 编辑器创建邀请码（将邮箱换成被邀请者的真实邮箱；此操作不发送邮件）：

```sql
insert into public.beta_invites(code,email,expires_at)
values(replace(gen_random_uuid()::text,'-',''),'hr@example.com',now()+interval '7 days')
returning code,email,expires_at;
```

将邀请码与邮箱单独交给测试者。过期、已用、邮箱不匹配均不能注册。
如需增加某个用户额度，在 SQL 编辑器明确调整 `beta_usage`，不要给浏览器更新权限。
额度是累计资源创建数，手动重试和评分卡重评计入 AI 请求数，但不额外计入简历数。

## 存储与数据

私有 bucket 为 `resumes`，单文件最大 10 MB，只接受 PDF / DOCX。
简历路径为 `userId/jobId/uuid.ext`。JD 临时文件使用 `userId/jd/uuid.ext`，解析完成后删除。
未能提交元数据的文件可能成为孤立对象：管理员清理前必须核对 `candidates.file_key`，不要在不确定接口结果时直接删除。
每个用户的 Storage 对象数量也受额度限制；这是防滥用上限，不代替账单告警。

候选人任务状态以 `evaluations.status` 为唯一来源，API 联表返回；避免在 candidates 中再维护一份相互冲突的状态。
`analysis_slots` 保留过期前的真实运行名额，即使评分卡被修改，旧请求完成前也不会多发新 AI 调用。
`ai_calls` 只存模型、关联 ID、token、耗时、状态与错误码，不存完整 prompt、简历或响应。
原简历及解析文本属于产品数据，仍存储在私有 Storage / candidates，用于重评；不是 AI 调用日志。

## 云端发布后必须人工执行

- 两个真实测试账号各创建岗位，尝试访问另一个账号的岗位、候选人、Storage 文件和接口，确认均不可越权。
- 使用无效、过期、已使用和邮箱不符的邀请码直接调用 Auth API，确认注册失败。
- 上传 20 份脱敏 PDF / DOCX，包含接近 10 MB 的文本型 PDF；浏览器网络记录里大文件应只发往 Storage。
- 提交后关闭全部页面；几分钟后重新登录，确认任务自动完成、排序出现。
- 模拟 AI 429 / 超时，验证定时函数最多自动重试 2 次；观察 `analysis_slots` 和 AI 日志，单用户不超过 3 并发。
- 修改评分卡确认重评，旧分数立即消失；重复提交旧版本应被拒绝。修改 JD 后必须重新确认评分卡才能评分。
- 开关浏览器标签可见性，验证没有运行任务时停止轮询，回到前台立即刷新。
- 在岗位底部填写独立的 HR 排序，记录 Top5 / Top10 重合率和样本数。不要将不足 10 人的结果称为完整 Top10 验证。
- 测试达到岗位/简历/AI 请求额度后的提示；验证个人 Key 可用且不会回显。

## 运维与回滚

观察 Netlify 函数失败日志、`evaluations.error_code`、`jobs.generation_error_code`、排队时间和 `ai_calls.success`。
失败日志不应包含真实简历内容。后台配置缺失时首次投递会交给定时恢复；持续等待通常意味着定时函数或服务端变量未配置。
定时任务 SQL/RPC 错误会让函数失败，便于 Netlify 监控发现。
先回滚新应用代码到兼容同一数据库迁移的提交；不要直接回滚到使用 authenticated 写业务表的原版。
若必须完整回退，暂停写入并恢复迁移前数据库备份及对应版本，核对新上传文件，避免数据丢失。

参考：[Netlify 后台函数](https://docs.netlify.com/build/functions/background-functions/)、[Netlify 函数配置](https://docs.netlify.com/build/functions/configuration/)、[DeepSeek 模型价格](https://api-docs.deepseek.com/quick_start/pricing/)。
