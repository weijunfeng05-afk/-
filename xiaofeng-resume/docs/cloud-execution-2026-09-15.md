# 云端部署执行记录（2026-09-15）

## 当前结果

本地部署整理和验证已执行。真实云端部署尚未执行，原因是当前执行环境没有可用的 Netlify / Supabase 管理凭据、目标项目标识、数据库连接及目标项目配置。
用户已授权普通部署操作；当前缺少的是实际访问凭据，不是等待重复授权。没有推断、创建或删除任何云端项目，也没有轮换现有密钥。

## 修改文件

- 根目录 `netlify.toml`：base 改为 xiaofeng-resume，构建 Next.js，发布 .next，配置后台函数目录，去掉旧 SPA 静态重定向。
- 根目录 `.env.example`：补齐应用运行变量、Netlify / Supabase 管理凭据和目标项目标识。文件内无真实值。
- 根目录 `README.md`：指向当前应用，记录备份位置和启动入口。
- 根目录 `.env.local`、应用目录 `.env.local`：已创建配置文件；根目录已安全复用旧应用的 DeepSeek Key，其他云端变量仍为空。已通过 git check-ignore 验证，未提交。
- `xiaofeng-resume/scripts/deployment-env.mjs`：安全初始化、缺项检查、冲突拒绝、兼容 anon key 别名；不打印密钥。
- `xiaofeng-resume/scripts/cloud-preflight.mjs`：只读检查已有凭据对应的 Netlify、Supabase、Auth 和 DeepSeek；跳过缺项服务，整体未就绪仍返回非零状态。
- `xiaofeng-resume/scripts/next-local.mjs`：本地启动时读取根目录和应用目录配置。
- `xiaofeng-resume/package.json`：新增配置和云端预检入口，更新本地启动入口。
- `xiaofeng-resume/tests/deployment.test.mjs`：新增 4 项部署配置回归测试；preflight.test.mjs 新增 1 项部分配置与日志保护测试。
- 应用 README 和部署说明：同步根目录已完成迁移的状态。
- 旧 backend、frontend、scripts、tests、docs、tools、render.yaml、requirements.lock、pytest.ini：先验证 Git 源码备份，再移入忽略目录，不参与部署。逐文件清单见 `cloud-change-list.txt`。

## 备份

源码 ZIP：`.qa/deployment-backup/pre-cloud-cleanup-b543389.zip`。
旧工作目录：`.qa/deployment-backup/legacy-working-tree/`。
原有 `data/`、`.env`、`.venv/` 保留。未删除线上数据或项目，未更换原有加密密钥。

## Supabase 改动清单

线上：无。无法鉴权，未运行迁移、未修改 RLS / Storage / Auth、未创建用户或邀请码。
待连接后：确认目标库和已执行版本，检查备份，依次应用缺少的 001～009 迁移，检查 RLS、私有 resumes bucket、Auth URL、邮箱验证和邀请码触发器。
已有生产数据或加密个人密钥时必须沿用已有 API_KEY_ENCRYPTION_SECRET，不自动生成替代值。

## Netlify 配置清单

本地配置已就绪：base=xiaofeng-resume；command=pnpm run build；publish=.next；functions=netlify/functions；Node=22。
线上：无。尚未连接站点，未上传 Environment Variables，未触发生产部署。
部署地址：未生成、未验证。

## 测试结果

本地业务与部署配置自动测试：36 项通过。包含 A/B RLS、后台处理、重试、证据验证、版本锁以及新增配置保护测试。
TypeScript 与生产构建通过。新增脚本静态检查通过。
配置检查：ready=false，11 项配置缺少值；DEEPSEEK_API_KEY 已配置。该结果用于阻止误部署，不能当作产品云端测试成功。
DeepSeek 官方 /models 只读公网检查返回 HTTP 200，现有密钥认证成功；未调用付费模型，未轮换密钥。

真实公网注册、登录、退出、A/B 数据隔离、创建岗位、Scorecard、上传、AI、刷新持久化和失败重试：全部未执行，受同一凭据缺口阻塞。

## 继续执行需要的输入

请在根目录 `.env.local` 私下填写云端管理凭据及目标信息，勿在聊天粘贴密钥。
NETLIFY_AUTH_TOKEN / NETLIFY_SITE_ID；SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF；Supabase URL / publishable 或 anon key / service role key；DATABASE_URL；SITE_URL。DeepSeek Key 已复用，不需再次填写。
已有 API_KEY_ENCRYPTION_SECRET / BACKGROUND_SECRET 请沿用；若不存在，连接目标项目并确认后再首次生成，不作密钥轮换。
只需回复配置已完成，即可继续连接、读取线上状态、迁移、配置环境变量和公网验收。
