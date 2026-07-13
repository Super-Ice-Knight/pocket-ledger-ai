# 口袋记账 AI 版

面向学生和年轻用户的 AI 记账 Web 应用。用户可以输入一句中文收支记录，由 OpenAI 兼容模型解析为结构化草稿，确认后写入 SQLite；模型不可用时，系统会回落到可解释的本地规则。当前公开部署使用 Groq 上的 Qwen 3.6 作为低延迟主模型，代码仍保留可选备用 Provider 能力。

## 在线入口

- 在线演示：[pocket-ledger-ai.vercel.app](https://pocket-ledger-ai.vercel.app/)
- GitHub：[Super-Ice-Knight/pocket-ledger-ai](https://github.com/Super-Ice-Knight/pocket-ledger-ai)
- 后端 API：[pocket-ledger-ai.onrender.com](https://pocket-ledger-ai.onrender.com/)
- 健康检查：[GET /api/health](https://pocket-ledger-ai.onrender.com/api/health)
- Swagger 文档：[FastAPI /docs](https://pocket-ledger-ai.onrender.com/docs)

Render 免费实例在闲置后会休眠，首次访问可能需要约一分钟唤醒。线上 SQLite 为演示级存储，实例重建或重新部署后数据可能重置；本地版本提供完整持久化。

## 界面预览

![总览页](docs/assets/dashboard-desktop.png)

![手机快记页](docs/assets/quick-entry-mobile.png)

## 核心能力

- 一句话记账：解析金额、类型、分类、账户、时间、备注和标签。
- 确认后入账：AI 只生成草稿，用户确认后才写数据库。
- 可选主备模型：配置备用接口后自动容灾；未配置时直接回落本地规则。
- 本地兜底：所有已配置 Provider 都不可用时，使用确定性规则完成常见句子解析。
- AI 财务点评：由用户手动触发模型，输出一句话结论、详细分析和行动建议；结果持久化到 SQLite，数据未变时直接读取缓存。
- 整数分存储：金额统一保存为整数“分”，避免浮点误差。
- 日期分组流水：按天展示笔数、收入、支出、净额和自定义标签。
- 预算与分析：预算风险、消费趋势、分类占比和账户分布均配有文字结论。
- 响应式工作台：桌面长页面中侧栏底板与主工作区等高、导航保持在视口；平板改为上下布局，手机使用顶部设置和底部五项导航。
- 真实设置：本地环境可保存主备 API；公开演示环境只读，Key 由 Render 环境变量管理。
- 故障反馈：Render 冷启动、网络错误、模型失败和非法输入都有明确恢复路径。

## AI 快记流程

```text
自然语言
   ↓
主模型（OpenAI 兼容接口）
   ↓ 失败
备用模型（可选）
   ↓ 失败
本地确定性规则
   ↓
字段归一化与 Pydantic 校验
   ↓
待确认草稿
   ↓ 用户确认
SQLite
```

本地金额规则不是简单取第一个数字。系统优先识别“50元/50块”，再识别“花了50、收入2000、共50”等金额语境；日期和数量同时出现但金额不明确时，会把金额标记为缺失，交给用户确认。

AI 点评不跟随页面加载、普通刷新或每次入账自动调用模型。总览和预算页只读取当前月份与语气的已保存结果；账单、预算、模型配置或 Prompt 版本变化时，旧结果会标记为“待更新”，只有点击“生成点评/重新分析”才会发起新的模型请求。

当前公开部署经过一次真实链路优化：早期 Agnes 与硅基流动从 Render Oregon 调用时出现 20–45 秒延迟或超时，因此最终改用 Groq `qwen/qwen3.6-27b`，并把超时收紧为 10 秒。2026-07-13 验收时，Provider 服务端测试为 917 ms，普通中文快记为 3.64 秒，汉字金额“两千元”为 4.87 秒，结构化月度点评为 5.25 秒。线上暂不配置慢速备用接口，避免失败链路串行累加等待。

## 技术结构

- 前端：Vite、React、TypeScript、Tailwind CSS、Recharts、Phosphor Icons
- 后端：FastAPI、SQLite、Pydantic、httpx
- AI：OpenAI 兼容 Chat Completions，支持主模型、备用模型和本地兜底
- 验证：pytest、TypeScript 构建、Playwright 桌面与手机检查

```text
frontend/              React 前端
backend/app/           FastAPI、SQLite、AI 与统计逻辑
backend/tests/         后端行为测试
docs/                  产品、接口、部署、演示与答辩文档
AI_LOG.md              AI 协同开发日志
render.yaml            Render 部署配置
```

## 本地运行

### 1. 后端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy ..\.env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

后端地址为 `http://127.0.0.1:8000`，接口文档为 `http://127.0.0.1:8000/docs`。

### 2. 前端

```powershell
cd frontend
npm install
npm run dev
```

默认访问 `http://127.0.0.1:5173`。如果后端运行在其他端口，在 `frontend/.env.local` 中设置：

```env
VITE_API_BASE_URL=http://127.0.0.1:8001
```

## AI 配置

复制根目录 `.env.example` 为 `backend/.env`，填写自己的 Key：

```env
OPENAI_COMPATIBLE_BASE_URL=https://api.groq.com/openai/v1
OPENAI_COMPATIBLE_MODEL=qwen/qwen3.6-27b
OPENAI_COMPATIBLE_API_KEY=
BACKUP_OPENAI_COMPATIBLE_BASE_URL=
BACKUP_OPENAI_COMPATIBLE_MODEL=
BACKUP_OPENAI_COMPATIBLE_API_KEY=
AI_REQUEST_TIMEOUT_SECONDS=10
RUNTIME_AI_SETTINGS_WRITABLE=true
```

备用 Provider 是可选项，只有在独立测试确认延迟和 JSON 输出都合格后才应填写。不要为了展示“主备”而把已知慢接口留在关键链路中。本地默认允许设置页写入 SQLite；公开部署应设置 `RUNTIME_AI_SETTINGS_WRITABLE=false`，并把密钥保存在 Render 环境变量中，避免访客修改运行配置。

不配置任何 Key 时应用仍能运行，但 AI 快记和财务点评会明确显示“本地规则”来源。

## 验证

后端测试：

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

当前覆盖 20 项行为，包括金额精度、日期与数量排除、主备切换、双模型失败兜底、未知字段归一化、Groq 非推理模式、包装 JSON 解码、设置只读和 Key 防泄漏。

模型正常时已经实测识别“昨天兼职收入两千元”为 200000 分；确定性本地兜底目前只承诺阿拉伯数字金额。一句话快记当前对应一笔账，同时包含收入和支出的句子应拆成两次输入，月度统计会自动计算净额。

前端构建：

```powershell
cd frontend
npm run build
```

完整发布检查见 [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)。

## 三分钟演示

1. 总览：现金流、预算状态，并手动生成一次带 provider 标记的 AI 点评。
2. AI 快记：输入自然语言，检查结构化草稿与来源。
3. 确认入账：强调 AI 不直接写库。
4. 流水与分析：日期分组、标签、图表和文字结论。
5. 设置：展示 Groq 主模型测试和公开演示只读边界。
6. 工程说明：整数分、SQLite、点评指纹缓存、可选 Provider 容灾和本地规则。

录制前预热步骤与逐段讲稿见 [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)。

## 答辩资料

- [AI 协同开发日志](AI_LOG.md)
- [产品规格](docs/PRODUCT_SPEC.md)
- [API 契约](docs/API_SPEC.md)
- [部署说明](docs/DEPLOYMENT.md)
- [答辩备忘](docs/DEFENSE_NOTES.md)
- [开发流水](docs/DEV_LOG.md)

## 数据与安全边界

- 第一版为单用户演示，不包含登录和多用户权限。
- API Key 不通过公开接口回显，也不提交到 GitHub。
- 公开演示关闭运行时配置写入；本地环境保留真实设置能力。
- SQLite 免费线上实例可能重置，因此线上用于体验，本地用于完整答辩。
- 不包含银行同步、OCR、语音输入、原生 App 或复杂资产管理。
