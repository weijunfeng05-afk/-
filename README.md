# 小锋牌简历 V1.1 Beta

当前应用：`xiaofeng-resume/`，技术栈为 Next.js + Netlify + Supabase。
根目录 `netlify.toml` 已指向此目录，不再部署旧前端静态站点。

## 本地运行与部署准备

在 `xiaofeng-resume` 中执行：

```sh
pnpm install --frozen-lockfile
node scripts/deployment-env.mjs --init
pnpm test
pnpm build
```

根目录 `.env.local` 是部署凭据入口，已被 Git 忽略。应用目录 `.env.local` 也被忽略，空模板不会覆盖已有配置。
配置脚本仅报告缺少的变量名，不打印任何密钥；发现根目录和应用目录配置冲突会拒绝继续。
只读云端检查：`node scripts/cloud-preflight.mjs`。缺少凭据时明确返回未就绪，不会声称已部署。

数据库迁移、后台任务、Auth、Storage、云端测试要求见 [部署说明](xiaofeng-resume/docs/NETLIFY-SUPABASE.md)。

## 旧代码备份

2026-09-15 迁移前的旧实现源文件已备份到 `.qa/deployment-backup/pre-cloud-cleanup-b543389.zip`。
旧工作目录（包括开发依赖）移到 `.qa/deployment-backup/legacy-working-tree/`，不参与新部署。
原有 `data/`、`.env` 和 `.venv/` 保留，未删除本地数据或原有加密密钥。
`.qa` 备份目录被 Git 忽略，请单独保管。此操作未更改任何线上项目。
