# 上线部署清单（内测版）

> 让另一个 AI（Codex）替你执行部署时，请把 [DEPLOY-HANDOFF.md](DEPLOY-HANDOFF.md) 交给它 ——
> 那份是含命令、接口与校验步骤的可执行手册；本文件是给你自己看的checklist 与说明。

目标：把「小锋牌简历筛选机」部署到一个 HTTPS 网址，同事用浏览器打开后**自行注册账号**，
各自的岗位、简历、评分结果**互相看不到**，数据持久保存（重启不丢）。

技术分层：

| 能力 | 由谁提供 |
| --- | --- |
| 账号与登录 | Supabase Auth |
| 数据存储与隔离 | Supabase PostgreSQL + RLS 行级安全策略 |
| 简历文件存储 | Supabase Storage 私有桶 `resumes` |
| 网页与接口 | Netlify（Next.js 运行时 + 后台函数） |
| 大模型调用 | 各用户自填 DeepSeek Key（服务端加密保存） |

---

## 一、你需要准备的账号

1. **Supabase**：https://supabase.com —— 免费档足够内测
2. **Netlify**：https://www.netlify.com —— 免费档可用，但需确认账户支持 **Background Functions**
3. （可选）一个域名，用于替换默认的 `xxx.netlify.app` 地址
4. 代码仓库：把 `xiaofeng-resume` 推到 GitHub / GitLab，供 Netlify 自动构建（也可用 Netlify CLI 手动部署）

---

## 二、Supabase 配置（约 15 分钟）

### 1. 建项目
New project → 选区域（建议新加坡 / 东京，离国内近）→ 设置数据库密码并保存好。

### 2. 执行数据库迁移
仓库里已备好脚本，跨平台、UTF-8 安全、带自动校验：

```bash
node scripts/push-supabase-migrations.mjs --list   # 只看有哪些项目，不做修改
node scripts/push-supabase-migrations.mjs          # 正式执行（ref 填在 .env.setup.local）
```

如果不想用脚本，就打开 **SQL Editor**，按文件名顺序逐个执行 `supabase/migrations/` 下的脚本：

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
011_open_signup.sql     ← 新增：把注册改为开放注册
```

> 每个脚本自带事务，**必须整份复制执行，不要拆开跑**；执行完一个在记事本里记一笔，避免漏执行或重复执行。
> `002` 会创建 `app_backend` 角色，业务请求靠它 + RLS 实现数据隔离。

### 3. 私有存储桶（无需手动创建）

迁移 `001_multiuser.sql` 里已经用 SQL 建好了私有桶 `resumes`：公开读关闭、单文件上限 10 MB、
只允许 PDF 与 DOCX，并附带了 4 条按用户隔离的存储策略。

**不要去 Storage 页面手动建同名桶**，会主键冲突报错。只需要执行完迁移后确认它存在即可：

```sql
select id, public, file_size_limit from storage.buckets where id='resumes';
-- 预期：resumes | false | 10485760
```

### 4. 配置登录方式
Authentication → Sign In / Providers：

- 确认 **Email** 已启用
- 内测建议把 **Confirm email（邮箱验证）关掉** —— 否则每位同事都要先点邮件链接才能登录，
  而 Supabase 免费档的邮件配额有限（约每小时 2～4 封），人多时容易卡住。
  关掉后注册即可直接登录，体验最顺。
- 如果要保留邮箱验证，需要自行配置 SMTP（Resend / SendGrid 等），否则极易触发限流。

Authentication → URL Configuration：

- **Site URL**：填最终网址，例如 `https://xiaofeng.netlify.app`
- **Redirect URLs** 追加：`https://你的域名/auth/callback`

### 5. 取凭据
Project Settings → API：

- `Project URL` → 环境变量 `NEXT_PUBLIC_SUPABASE_URL`
- `anon` / `publishable` key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`（**仅服务端，绝不可暴露给浏览器**）

Project Settings → Database → Connection string → **Transaction pooler**（6543 端口）：

- 把 `[YOUR-PASSWORD]` 换成数据库密码 → 环境变量 `DATABASE_URL`

> `DATABASE_URL` 使用的连接角色必须有权 `SET ROLE app_backend`，默认的 `postgres` 角色即可。

---

## 三、生成两个密钥

在任意有 Node.js 的机器上执行：

```powershell
node -e "console.log('API_KEY_ENCRYPTION_SECRET=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('BACKGROUND_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

- `API_KEY_ENCRYPTION_SECRET`：用于加密同事自己填写的 DeepSeek Key。
  **务必单独保存一份**，一旦丢失，已保存的个人密钥将无法解密。
- `BACKGROUND_SECRET`：API 与定时函数之间的内部投递鉴权。

---

## 四、Netlify 部署

1. New site → Import from Git → 选择本仓库
2. **Base directory 填 `xiaofeng-resume`**（若仓库根目录就是应用目录则留空）
3. Build command / Publish 已在 `netlify.toml` 中配好：
   - build：`pnpm run build`
   - publish：`.next`
   - 插件：`@netlify/plugin-nextjs`
4. 在 **Site configuration → Environment variables** 逐条添加：

| 变量 | 值 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | 公开 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | anon key | 公开 |
| `DATABASE_URL` | Transaction pooler 连接串 | 服务端 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | 服务端 |
| `API_KEY_ENCRYPTION_SECRET` | 上一步生成 | 服务端 |
| `BACKGROUND_SECRET` | 上一步生成 | 服务端 |
| `SITE_URL` | `https://你的域名` | 服务端 |
| `DEEPSEEK_API_KEY` | **留空** | 各人填自己的 Key |
| `DEEPSEEK_JOB_MODEL` | `deepseek-v4-pro` | 可选 |
| `DEEPSEEK_RESUME_MODEL` | `deepseek-flash` | 可选 |

> **关键**：不要设置 `NEXT_PUBLIC_AI_MODE`，也不要设置 `NEXT_PUBLIC_SIMPLE_LOGIN`。
> 两者一旦有值，应用会切到「本地内存模式」或「简易登录」，线上就会绕开 Supabase，数据不落库。

5. Deploy site

> 如果免费档不支持 Background Functions，AI 分析会退化为「定时任务补偿」模式：
> 上传后需要等待 `recover-analysis` 定时函数（每分钟）接管，**结果会慢 1 分钟左右才出现**，功能不受影响。

---

## 五、部署后验收（务必逐条走一遍）

- [ ] 打开网址能进入登录页，且显示的是「注册 / 登录」而不是「内测账号」
- [ ] 用邮箱 A 注册 → 能直接进入工作台
- [ ] 「API 设置」填 Key → 点测试 → 显示连接成功
- [ ] 新建岗位（粘贴 JD）→ 等待生成评分卡 → 保存评分卡
- [ ] 上传一份简历 → 等待评分完成 → 能看到分数、维度明细与原文证据
- [ ] 点击下载原始简历 → 能正常打开文件
- [ ] **用邮箱 B 注册并登录 → 岗位列表为空**（确认数据隔离生效）
- [ ] **把 Netlify 重新部署一次，再回到 A 账号 → 数据仍在**（确认已落库，不再因重启丢数据）

---

## 六、日常运维

- **额度**：默认每人 10 个岗位 / 200 份简历 / 1000 次 AI 请求，写在 `beta_usage` 表。
  需要给某人加量在 SQL Editor 里改，不要给浏览器开放写权限。
- **想收紧注册**：`011_open_signup.sql` 已把邀请码改为「选填」。若要恢复强制邀请，
  重新执行 `002_beta.sql` 里的触发器定义即可；邀请码表 `beta_invites` 仍然保留。
  发码方式：
  ```sql
  insert into public.beta_invites(code,email,expires_at)
  values(replace(gen_random_uuid()::text,'-',''),'hr@example.com',now()+interval '7 days')
  returning code,email,expires_at;
  ```
- **备份**：Supabase 免费档有自动备份但保留期短，重要数据请定期用
  `pg_dump "$DATABASE_URL" > backup.sql` 自行导出。
- **成本**：Supabase 免费档数据库长期无访问会休眠，首次访问会有几秒唤醒延迟，属正常现象。
