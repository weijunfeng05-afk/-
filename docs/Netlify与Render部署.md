# Netlify 前端 + Render 后端

此配置部署根目录的 React/FastAPI MVP（本地 8000），不部署 `.qa/legacy-resume` 的 Streamlit 旧版（8502）。岗位模板化拆解和历史分析功能位于根目录项目。

## 准备授权

在浏览器登录 Netlify 和 Render，并通过两家的 GitHub 授权流程选择本项目仓库。密码、GitHub Token 和 DeepSeek API Key 不需要发送到聊天中。创建 Render 资源前核对账单：`render.yaml` 使用 Starter 付费 Web Service 和 1 GB 持久化磁盘；没有创建任何付费资源。

## 部署顺序

1. Netlify 新建站点，连接 GitHub 仓库 `weijunfeng05-afk/-` 中包含本次提交的分支。配置由根目录 `netlify.toml` 提供：目录 `frontend`，构建 `pnpm build`，发布 `dist`。记下正式 `https://xxx.netlify.app` 地址。后端配置好之前，前端尚不能使用。
2. Render 从同一仓库导入 Blueprint `render.yaml`，确认套餐与磁盘费用。填写 `RESUME_FRONTEND_ORIGIN` 为上一步正式地址（不带尾斜杠）。Render 自动注入后端主机名；其他 Python 平台需填写 `RESUME_ALLOWED_HOST`。
3. 在可信本机运行 `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` 生成 `RESUME_MASTER_KEY`，直接填入 Render 环境变量并妥善保存。以后部署不要更换，否则已保存的模型密钥无法解密。
4. `RESUME_ACCESS_TOKEN` 由 Render 生成，是你的工作空间访问密钥；从 Render 环境变量中取得，使用应用时输入。不要放入 Netlify 的 `VITE_*` 环境变量。
5. 在 Netlify 添加非秘密构建变量 `VITE_API_BASE_URL=https://实际后端地址.onrender.com`（不带 `/api`），重新部署。前端请求直接到后端，避免大文件经过 Netlify 代理。前端域名变化后，也需更新 Render 的 `RESUME_FRONTEND_ORIGIN`。
6. 打开 Netlify 页面，输入工作空间访问密钥，再在“模型配置”填写 DeepSeek 接口及 API Key。使用虚构简历检查上传、分析、下载和历史记录；重启后端确认数据仍存在。

## 存储与边界

- 数据库 `/var/data/app.sqlite3`、简历 `/var/data/files/` 都在 Render 持久化磁盘中。仅运行一个后端实例和一个 worker。
- API、简历下载和历史结果都验证访问密钥，仅允许配置的前端来源。当前是单人工作空间，不提供多用户权限隔离。浏览器会话中保存访问密钥，点击“退出工作空间”清除。
- Netlify 只发布静态前端，不含简历、数据库或 DeepSeek Key。本机数据不会自动上传云端。
- 当前仅完成本机验证和部署配置准备；云端部署、账单确认和真实 DeepSeek 调用需在账号连接后验收。
- 前端必须使用 HTTPS 后端地址；不要在部署中使用 `127.0.0.1`。

官方参考：[Netlify 函数运行环境](https://docs.netlify.com/build/functions/overview/)、[Render 持久化磁盘](https://render.com/docs/disks)、[Render Blueprint 配置](https://render.com/docs/blueprint-spec)。
