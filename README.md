# 小锋牌简历筛选机 V1.1 Beta

当前应用位于 [`xiaofeng-resume/`](xiaofeng-resume/)。使用 Next.js 16、Netlify Functions、Supabase Auth / PostgreSQL / 私有 Storage 和 DeepSeek。

仓库根目录的 `netlify.toml` 将构建目录指向 `xiaofeng-resume`，并启用 Netlify Next.js 运行时插件。部署所需的环境变量、数据库迁移和云端验收步骤见 [上线部署清单](xiaofeng-resume/docs/GO-LIVE.md)。

本地开发与验证请在 `xiaofeng-resume` 中运行：

```
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

不要将任何实际密钥或真实简历数据提交到 GitHub。旧版源码及迁移前备份保存在本地 `.qa/deployment-backup/`，该目录不上传。
