# 上线部署执行手册（交付给 Codex 执行）

> 本文档是**可执行手册**：按顺序做即可把「小锋牌简历筛选机」部署到公网 HTTPS 地址，
> 支持同事自助注册、数据落库、按账号隔离。
>
> 代码就在这里，不要 clone 其它仓库：仓库根目录 = `xiaofeng-resume/`（即本文件所在仓库）。

---

## 0. 目标与验收标准

最终要达到：

1. 有一个 HTTPS 网址，任何人打开能看到「登录 / 注册」页面
2. 同事用自己的邮箱自助注册，注册后能直接登录（不需要等验证邮件）
3. 每个账号只能看到自己的岗位、候选人、评分结果
4. 数据存在数据库里，**重新部署 / 重启服务后数据仍在**
5. 上传简历 → 真实调用大模型评分 → 能看到分数与原文证据 → 能下载原始简历

---

## 1. 执行前必须知道的硬约束（务必先读完再动手）

1. **`NEXT_PUBLIC_AI_MODE` 必须留空**（不要设置）。
   一旦设为 `real` 或 `demo`，应用会切到「本地内存模式」：不连 Supabase、数据存内存、重启即丢。
   这是本项目最容易踩的坑。

2. **`NEXT_PUBLIC_SIMPLE_LOGIN` 必须留空或 `false`**。
   设为 `true` 会启用「邮箱 + 统一密码 123456」的假登录，绕过 Supabase。

3. **`NEXT_PUBLIC_*` 变量在构建时被内联进前端代码**。
   在 Netlify 上改了 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 之后，
   **必须重新部署（rebuild）**才生效，只重启不重建无效。

4. **数据库迁移脚本不能重复执行**（`002` 等脚本里有 `create table`，重复跑会报「已存在」）。
   执行前先确认目标库是空库；如果不确定已执行到哪一步，先查表判断，不要盲目重跑。

5. **存储桶 `resumes` 不需要手动创建**。
   `001_multiuser.sql` 里已经用 `insert into storage.buckets ...` 建好了私有桶（10MB 上限、只允许 PDF/DOCX），
   连 RLS 策略一起建好了。**不要再去后台手动建桶**，会主键冲突。

6. **定时恢复任务不需要在 netlify.toml 里配 cron**。
   `netlify/functions/recover-analysis.ts` 里已用 `export const config={schedule:'* * * * *'}` 声明每分钟执行。

7. **`work/e2e-test.mjs` 只能用于本地内存模式验证，不要拿去测线上**。
   它通过伪造 `xf_user` cookie 来模拟登录，线上用的是 Supabase 会话，跑不通是正常的。

---

## 2. 需要人类提供的凭据（Codex 无法自己获取）

向用户索取以下 3 项，写进环境变量或临时文件，**不要在日志里打印明文**：

| 名称 | 从哪拿 |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens → Generate new token（形如 `sbp_...`） |
| `SUPABASE_DB_PASSWORD` | 创建 Supabase 项目时设置的数据库密码 |
| `NETLIFY_AUTH_TOKEN` | app.netlify.com/user/applications → New access token |

可选：`SUPABASE_PROJECT_REF`（若用户有多个项目则必填，否则先列出来让用户确认）。

> 本仓库已准备好模板文件 `.env.setup.local`（匹配 `.gitignore` 的 `.env*` 规则，不会被提交）。
> 让用户把令牌填进去，然后从该文件读取，避免令牌出现在对话记录中。

---

## 3. 阶段一：Supabase 配置

所有请求都要带 `Authorization: Bearer $SUPABASE_ACCESS_TOKEN`。
Management API 限流为 **每分钟 60 次**，逐个文件执行迁移完全够用，但不要并发轰炸。

### 3.1 确认项目

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects
```

- 从返回里取 `id`（即 project ref）和 `region`。
- 如果用户给了 `SUPABASE_PROJECT_REF`，核对与返回一致。
- 如果用户有多个项目，**停下来让用户确认要操作哪个**，不要自己挑。

把 ref 记为 `$REF`，后面所有请求都用它。

### 3.2 按顺序执行 11 个迁移脚本

文件在 `supabase/migrations/`，**必须严格按以下顺序**（文件名前缀即顺序）：

```
001_multiuser.sql
002_beta.sql
003_recovery.sql
004_workflows.sql
005_job_tasks.sql
006_hardening.sql
007_dispatch.sql
008_edit_job.sql
009_atomic_completion.sql
010_delete_cascade.sql
011_open_signup.sql
```

**推荐方式：直接运行仓库里准备好的脚本**（跨平台，UTF-8 安全，含校验）：

```bash
# 只是为了看有哪些项目，不做任何修改
node scripts/push-supabase-migrations.mjs --list

# 确认好项目 ref 后正式执行（ref 填在 .env.setup.local 里）
node scripts/push-supabase-migrations.mjs
```

脚本会依次完成：列出项目 → 核对 ref → 逐个执行 11 个迁移（任一失败立即停止并打印原始返回）
→ 自动做结构校验（业务表、存储桶配置、存储策略、触发器、011 是否生效）。

**为什么不建议用 curl**：迁移文件里有大量中文，PowerShell 的 `curl` / `--data` 会造成编码损坏，
必须写成 UTF-8 文件再 `--data-binary @文件`。用 Node 脚本可以直接绕开这类问题。

**如果脚本走不通**（例如账户权限不支持 Management API 的 SQL 执行接口，返回 404/403）：

- 降级方案 A：让用户从 Dashboard → SQL Editor 里**逐个文件粘贴执行**（每个文件整份粘贴，不要拆开）。
- 降级方案 B：用 `psql` 走 **Session Pooler（5432 端口）** 连接串逐文件执行：
  ```bash
  psql "$DATABASE_URL_SESSION" -v ON_ERROR_STOP=1 -f supabase/migrations/001_multiuser.sql
  ```
  连接串构造规则见 3.4。**不要用 6543 端口的 Transaction Pooler 跑迁移**（多语句事务语义不同）。

### 3.3 迁移后立即验证（必做）

如果用了上面的脚本，最后一步已经自动校验过了。如果要手工复核，执行以下 SQL 并核对预期：

```sql
-- 应返回 11 个左右的业务表，包含 jobs / candidates / evaluations / scorecards / beta_usage / beta_invites
select table_name from information_schema.tables where table_schema='public' order by 1;

-- 应返回 1 行：id='resumes', public=false, file_size_limit=10485760
select id,name,public,file_size_limit from storage.buckets where id='resumes';

-- 应返回 4 条存储策略
select policyname from pg_policies where schemaname='storage' and tablename='objects';

-- 应返回 2 个触发器：beta_registration（注册校验）、beta_usage_init（额度初始化）
select tgname from pg_trigger where tgname in ('beta_registration','beta_usage_init');

-- 应返回 true：确认 011 已生效（prosrc 里含 invite_code is null）
select (prosrc like '%invite_code is null%') as ok from pg_proc where proname='enforce_beta_invite';
```

任何一项不符 → **停下来排查，不要继续部署**。

### 3.4 取凭据

```bash
# 1) 项目 URL：https://<REF>.supabase.co
# 2) API 密钥（新版接口返回名称与明文）
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$REF/api-keys"
```

从返回里取：
- `anon` / `publishable` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `service_role` → `SUPABASE_SERVICE_ROLE_KEY`（**只写进服务端环境变量，绝不可加 `NEXT_PUBLIC_` 前缀**）

如果该接口没有返回密钥明文（部分账户/接口版本会脱敏），就让用户从
Dashboard → Project Settings → API 页面复制。

**数据库连接串**：项目 URL 用 `NEXT_PUBLIC_SUPABASE_URL`，另外还需要 **Transaction Pooler** 连接串给 `DATABASE_URL`：

```
postgresql://postgres.<REF>:<DB_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres
```

- `<REGION>` 取自 3.1 返回的 `region` 字段
- 密码若含 `@ : / ? #` 等字符**必须做 URL 编码**（例如 `@` → `%40`）
- 端口 `6543` = Transaction Pooler（应用运行时用）；端口 `5432` = Session Pooler（迁移换用时用）
- 若构造出的主机名连不上，让用户从 Dashboard → Settings → Database → Connection string 直接复制

### 3.5 配置 Auth（自助注册）

```bash
curl -s -X PATCH \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -d '{
    "mailer_autoconfirm": true,
    "disable_signup": false,
    "site_url": "https://<最终的 Netlify 域名>",
    "uri_allow_list": "https://<最终的 Netlify 域名>/auth/callback,http://localhost:3000/auth/callback"
  }'
```

要点：

- `mailer_autoconfirm: true` = **关闭邮箱验证**，注册后直接拿到会话，同事不必点邮件链接。
  这是内测必需项：Supabase 免费档邮件配额很小，留着邮箱验证会让大量人卡在收邮件这一步。
- `disable_signup` 必须为 `false`，否则自助注册被关闭。
- `uri_allow_list` 必须包含线上回调地址；**同时要加 `http://localhost:3000/auth/callback`**，
  否则第 4 阶段的本地生产模式验证会失败。
- 读回确认：
  ```bash
  curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$REF/config/auth" | grep -o '"mailer_autoconfirm":[^,]*'
  ```

### 3.6 生成两个应用密钥

```bash
node -e "console.log('API_KEY_ENCRYPTION_SECRET=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('BACKGROUND_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

- `API_KEY_ENCRYPTION_SECRET` 用于 AES-GCM 加密用户自己填的 DeepSeek Key。
  **必须单独留存一份备份**：丢失后已保存的个人密钥无法解密，用户只能重新填写。
- `BACKGROUND_SECRET` 用于 Netlify 内部函数之间的投递鉴权。

生成的这两个值**同时**写进：本地 `.env.local` 和 Netlify 环境变量，两边必须一致。

---

## 4. 阶段二：部署前先在本地用生产模式验收（强烈建议，不要跳过）

这一步能在花钱花时间部署之前，把 Supabase 侧的问题全部暴露出来。

1. 编辑 `.env.local`，填入/修改以下内容（其余保持原有）：

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<REF>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon key>
DATABASE_URL=postgresql://postgres.<REF>:<密码>@aws-0-<REGION>.pooler.supabase.com:6543/postgres
SUPABASE_SERVICE_ROLE_KEY=<service role key>
API_KEY_ENCRYPTION_SECRET=<生成的>
BACKGROUND_SECRET=<生成的>
SITE_URL=http://localhost:3000
DEEPSEEK_API_KEY=
```

**并且把这两行注释掉或删除**（这是关键）：

```ini
# NEXT_PUBLIC_AI_MODE=real
# NEXT_PUBLIC_SIMPLE_LOGIN=true
```

2. 启动并验证：

```bash
pnpm install
pnpm typecheck
pnpm test          # 预期 44 项全部通过
pnpm dev
```

打开 http://localhost:3000/login，**按顺序手工验证**：

- [ ] 页面显示的是「注册 / 登录」，不是「内测账号」
- [ ] 用邮箱 A 注册 → 能直接进入工作台（如果提示要收邮件，说明 `mailer_autoconfirm` 没生效，回 3.5）
- [ ] 新建岗位（粘贴一段真实 JD）→ 等待生成评分卡 → 保存
- [ ] 上传一份 PDF/DOCX 简历 → 等待评分完成 → 看到分数与原文证据
- [ ] 点下载原始简历 → 能正常打开
- [ ] 退出，用邮箱 B 注册登录 → **岗位列表为空**（数据隔离生效）
- [ ] 回到 A 账号 → 数据仍在

3. 本地这一轮全部通过后，**再进入 Netlify 部署**。任何一项失败都先解决，不要带着问题上线。

---

## 5. 阶段三：Netlify 部署

### 5.1 仓库已有的配置（不要改动语义）

`netlify.toml` 已经配好：

```toml
[build]
  command = "pnpm run build"
  publish = ".next"
[build.environment]
  NODE_VERSION = "22"
[[plugins]]
  package = "@netlify/plugin-nextjs"
[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  external_node_modules = ["unpdf", "mammoth"]
```

- `@netlify/plugin-nextjs` 插件是**必需**的：App Router、Route Handler、中间件（`proxy.ts`）都依赖它。
  缺了它，`publish = ".next"` 发布出去的内容无法被正确接管。
- `next.config.ts` 里的 `distDir` 已做环境判断：**Netlify 上（`NETLIFY=true`）用标准 `.next`**，
  本地才用 `.next-local`。所以不要硬编码修改它。

### 5.2 创建站点并配置环境变量

```bash
npx netlify-cli@latest sites:create --name xiaofeng-resume --auth "$NETLIFY_AUTH_TOKEN"
# 记录返回的 site_id

SITE=<site_id>
```

创建 `.env.production`（匹配 `.gitignore` 的 `.env*`，不会被提交）用于批量导入环境变量：

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<REF>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<anon key>
DATABASE_URL=postgresql://postgres.<REF>:<密码>@aws-0-<REGION>.pooler.supabase.com:6543/postgres
SUPABASE_SERVICE_ROLE_KEY=<service role key>
API_KEY_ENCRYPTION_SECRET=<生成的>
BACKGROUND_SECRET=<生成的>
SITE_URL=https://<最终域名>
DEEPSEEK_API_KEY=
DEEPSEEK_JOB_MODEL=deepseek-v4-pro
DEEPSEEK_RESUME_MODEL=deepseek-flash
```

导入：

```bash
npx netlify-cli@latest env:import .env.production --site "$SITE" --auth "$NETLIFY_AUTH_TOKEN"
```

**绝对不要**在这个文件里加入 `NEXT_PUBLIC_AI_MODE` 或 `NEXT_PUBLIC_SIMPLE_LOGIN`。

### 5.3 部署

```bash
npx netlify-cli@latest deploy --build --prod --site "$SITE" --auth "$NETLIFY_AUTH_TOKEN"
```

部署完成后：

1. 把站点域名（`https://<name>.netlify.app`，或自定义域名）回填到：
   - Supabase Auth 的 `site_url` 与 `uri_allow_list`（见 3.5，把 `<最终的 Netlify 域名>` 换掉并重新 PATCH）
   - Netlify 环境变量 `SITE_URL`（改了要**重新部署**才生效）
2. 回到 `https://<域名>/login` 走第 4 阶段的同一份验收清单。

> 顺序提示：`SITE_URL` 与 Supabase 回调地址互相依赖。推荐做法 —— 先用临时域名部署一次拿到域名，
> 再回填 `SITE_URL` 与 `uri_allow_list`，然后**再部署一次**。

### 5.4 如果免费档不支持 Background Functions

应用会自动降级：`lib/background.ts` 的 `dispatchSafely` 会吞掉投递失败，
由 `recover-analysis` 定时函数（每分钟）接管队列。

表现：上传简历/新建岗位后，结果**延迟约 1 分钟**才出现，功能不受影响。
如果连定时函数也不可用，需要升级 Netlify 套餐，否则任务会一直停在「等待中」。

---

## 6. 线上验收清单（交付前必须逐条打勾）

- [ ] 打开网址 → 登录页正常，显示「登录 / 注册」
- [ ] 邮箱 A 注册 → 直接进入工作台（无需收邮件）
- [ ] 「API 设置」填入自己的 DeepSeek Key → 点测试 → 连接成功
- [ ] 新建岗位 → 评分卡生成完成 → 保存评分卡
- [ ] 上传简历 → 评分完成，能看到分数、维度明细、原文证据
- [ ] 下载原始简历 → 文件能正常打开
- [ ] 邮箱 B 注册登录 → 岗位列表为空（数据隔离）
- [ ] **在 Netlify 后台手动触发一次重新部署（Deploys → Trigger deploy），回到 A 账号 → 数据仍在**
      （这一条是验证「数据真的落库了」的关键，务必做）
- [ ] 数据库里能查到数据：
      ```sql
      select count(*) from jobs; select count(*) from candidates;
      ```
- [ ] 检查 `API_KEY_ENCRYPTION_SECRET` 已单独备份到安全位置

---

## 7. 已知坑与排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 注册后提示「请检查邮箱并点击验证链接」 | `mailer_autoconfirm` 没生效 | 重新执行 3.5，并读回确认 |
| 打开网址 503「登录服务尚未配置」 | 缺 `NEXT_PUBLIC_SUPABASE_URL` 或 `PUBLISHABLE_KEY` | 补环境变量后**重新部署**（不是重启） |
| 注册报 500 | 迁移没跑完，或 `011` 没执行 | 按 3.3 逐项验证 |
| 每个人都能看到同样的数据 | 误设了 `NEXT_PUBLIC_AI_MODE`，跑在内存模式 | 删除该变量并重新部署 |
| 数据在重新部署后消失 | 同上（内存模式） | 同上 |
| 资源上传后一直「等待中」 | Background Functions 不可用 | 看 5.4；确认 `BACKGROUND_SECRET` 和 `SITE_URL` 正确 |
| 页面打开极慢（首次几秒） | Supabase 免费档数据库休眠唤醒 | 正常现象 |
| Netlify 构建报 esbuild / sharp 安装脚本被忽略 | pnpm 默认拦截依赖构建脚本 | 在 `pnpm-workspace.yaml` 的 `allowBuilds` 中补上对应包 |
| 迁移报 `already exists` | 重复执行了迁移 | 停止，先查询库中实际状态，不要继续 |
| 迁移报 `column reference "code" is ambiguous` | 执行的是旧版 `011` | 确认 `011_open_signup.sql` 里变量名是 `invite_code`（当前版本已修复） |

---

## 8. 回滚

- **代码回滚**：Netlify → Deploys → 选中上一个正常版本 → Publish deploy。
- **数据回滚**：迁移没有 down 脚本。上线前如果用真实数据测试过，删除项目重建即可；
  正式使用后请先 `pg_dump` 备份再动结构。
- **临时关闭注册**：执行 `011` 的反向操作（把 `enforce_beta_invite` 改回强制校验），
  或把 `002_beta.sql` 里的触发器定义重新执行一遍。邀请码表 `beta_invites` 一直保留可用。

---

## 9. 完成后请告知用户

1. 最终访问网址
2. 已配置的 Supabase 项目 ref（不要贴出密钥）
3. 提醒用户：
   - `API_KEY_ENCRYPTION_SECRET` 必须备份
   - 把 `.env.setup.local` / `.env.production` 删除，并到 Supabase / Netlify 后台**撤销这两个访问令牌**
   - 免费档限制：每个账号默认 10 个岗位 / 200 份简历 / 1000 次 AI 请求，不够可在 `beta_usage` 表调整
