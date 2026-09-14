# V1.1 数据库与接口

唯一数据库定义在 `supabase/migrations`，按 001～009 顺序迁移。Supabase Auth 验证身份，PostgreSQL RLS 隔离用户，浏览器只读业务表，服务端使用 app_backend 写入。

表：jobs（岗位及生成任务）、scorecards（不可变版本快照）、candidates（原文件路径与解析事实）、evaluations（当前任务状态及评分）、ai_calls（不含原始内容的调用日志）、api_settings（加密个人密钥）、beta_invites、beta_usage、analysis_slots、ranking_reviews。

| 接口 | 行为 |
|---|---|
| POST /api/jobs | 保存岗位，投递后台生成，立即返回 ID |
| PUT /api/jobs/:id | 校验版本后修改 JD，清空旧分数，重新生成并等待人工确认 |
| POST /api/jobs/:id/retry | 失败岗位重新排队 |
| PUT /api/jobs/:id/scorecard | version + scorecard + reanalyze；有候选人必须确认全量重评 |
| POST /api/documents | JSON storagePath/fileName；解析直传后的临时 JD 文件 |
| POST /api/candidates | JSON jobId/storagePath/fileName；验证私有对象后幂等入队，202 |
| GET /api/jobs/:id/candidates | 当前评分与状态，按分数降序、未出分排后 |
| GET /api/candidates/:id | 候选人原文、证据、评分卡与任务状态 |
| POST /api/candidates/:id/retry | 仅失败状态重新排队，增加 retry_count，202 |
| GET /api/candidates/:id/file | 鉴权后跳转至短时私有签名链接 |
| GET /api/jobs/:id/metrics | 成功率、失败率、平均耗时、Token、估算费用及排名快照 |
| POST /api/jobs/:id/ranking | 保存人工排序和当前 AI 排序快照 |
| GET /api/usage | 当前用户额度与累计使用 |

状态以 evaluations 为唯一来源：waiting → parsing → scoring → completed / failed。
数据库锁串行领取名额；analysis_slots 控制全局每用户 3 并发；同一 lease 同时保护候选人展示资料和评分结果。
评分卡修改清空所有旧分数，重置 lease，旧请求即使返回也不能覆盖新结果。JD 修改后，新评分卡未确认前暂停候选人任务。

错误包括 400 校验失败、401 未登录、403 无效来源、404 非本人或不存在、409 版本/锁定/额度冲突、503 服务暂不可用。
