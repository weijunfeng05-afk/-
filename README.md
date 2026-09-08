# 简历筛选助手

第一版 MVP，单人本机使用。React + TypeScript + Vite 提供界面，FastAPI 处理文件和模型调用，SQLite 保存岗位、任务及匹配结果。

## 第一版功能

- 岗位管理：粘贴或上传 PDF / DOCX JD，提取、编辑、确认岗位要求，设置硬性条件和加分项。
- 批量简历：一次最多 20 份，每份最多 10 MB；DOCX 支持段落和表格，PDF 保留页码；不支持扫描件 OCR。
- 匹配分析：数据库持久化队列，逐份执行，重复请求去重，失败重试，中断恢复。
- 结果核对：维度评分、硬性条件状态、排序筛选、原文引用、原文件下载和删除。
- 版本管理：岗位要求或模型配置变化后，历史结果标记需要重新分析。
- 模型配置：兼容 `/chat/completions` 的模型接口；API Key 在服务端加密保存，页面只返回掩码。

## 在 Windows 启动

需要 Python 3.12、Node.js 22 或以上以及 pnpm 11。脚本也支持自动使用当前用户已安装的 Codex 依赖运行时。

在项目目录打开 PowerShell，首次执行：

```powershell
.\scripts\setup.ps1
.\scripts\start.ps1
```

如果 PowerShell 的本机策略阻止脚本，可在确认脚本内容后直接运行 Python 入口：

```powershell
.\.venv\Scripts\python.exe scripts/run.py
```

打开 [本机应用](http://127.0.0.1:8000)。首次启动自动生成 `.env` 中的加密主密钥。服务仅监听 `127.0.0.1`，同一进程管理 API 和一个后台执行器，按 Ctrl+C 停止。

1. 进入“模型配置”，填写 Base URL、API Key 和服务商提供的模型名称，保存并测试连接。
2. 创建岗位，粘贴或上传 JD，提取要求，核对后点击“确认并保存”。也可手动填写要求。
3. 在工作台上传简历，点击“开始匹配”。查看详情中的评分、条件判断和原文证据。

Base URL 示例为 `https://服务地址/v1`，不要包含 `/chat/completions`。远程模型须使用 HTTPS；本机模型允许 HTTP。需要模型支持 JSON 对象输出及本项目的字段契约。

## 验证

```powershell
.\scripts\verify.ps1
```

脚本运行后端及方案文档回归测试、前端组件测试、TypeScript 检查和生产构建。也可分别运行：

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q
cd frontend
pnpm test
pnpm build
```

自动化测试使用固定模型响应和模拟 HTTP 服务，覆盖 60/80 分边界、权重归一化、信息不足、硬性条件否决、伪造引用、文件异常、任务去重、重试、租约恢复、删除竞态及配置加密。**真实模型验收仍待填写有效 API 配置后进行，自动化结果不代表已完成真实模型效果验收。**

## 开发

后端可直接执行 `scripts/run.py`。前端在 `frontend` 中运行 `pnpm dev`，Vite 将 `/api` 转发到本机 8000 端口。修改后端后需要重启服务；生产页面修改后需要 `pnpm build`。

依赖版本通过 `requirements.lock` 和 `frontend/pnpm-lock.yaml` 固定。

## 文件结构

| 目录 / 文件 | 内容 |
| --- | --- |
| `backend/` | 接口、SQLite、文件解析、模型适配、评分和后台执行器 |
| `frontend/` | 三个操作页面、交互、样式及组件测试 |
| `tests/` | 评分、解析、模型接口、任务集成和方案文档回归测试 |
| `scripts/` | 安装、启动及完整验证脚本 |
| `docs/` | 产品方案、技术方案及文档模板回归基线 |
| `tools/` | 原方案文档的生成与渲染验证工具 |
| `Agents.md` | 每次改动须更新测试并创建 Git commit 的项目约定 |

方案文档生成工具需要原始 System Design 模板，可通过 `MVP_TEMPLATE_PATH` 指定其路径；模板回归测试使用仓库内的哈希与几何基线，不依赖作者电脑上的模板路径。Word 渲染检查工具需要 Windows Word，并仅用于文档 QA。

## 数据与限制

- `.env`、`data/`、依赖目录、构建产物、日志、缓存和 `.qa/` 不提交 GitHub。源码、方案文档、测试、启动脚本和依赖锁文件可在新电脑重建应用。
- `data/app.sqlite3` 保存业务记录与加密后的 API Key；`data/files/` 保存原文件。备份时先停止应用，同时备份数据库和文件，单独妥善保管 `.env`。丢失主密钥后需重新保存 API Key。
- 原文上限为 60,000 字符，结构化模型输入上限为 110,000 字符，超出时明确报错，不静默截断。
- 评分只表示岗位相关程度，不代表录用概率。引用校验确认摘录存在，语义判断仍需人工核对。
- 首版没有账号权限、OCR、跨岗位自动推荐或自动联系候选人能力，不应直接开放到公网。
