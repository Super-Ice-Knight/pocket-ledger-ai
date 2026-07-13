# 部署说明

## 当前部署

- 前端：https://pocket-ledger-ai.vercel.app/
- 后端：https://pocket-ledger-ai.onrender.com/
- GitHub：https://github.com/Super-Ice-Knight/pocket-ledger-ai

前端是 Vite 静态站点，部署到 Vercel；后端是 FastAPI Web Service，部署到 Render；SQLite 位于后端文件系统。

## Render 后端

仓库根目录的 `render.yaml` 已包含构建、启动、Python 版本、CORS 和公开只读设置。手动创建服务时使用：

```text
Runtime: Python
Build Command: cd backend && pip install -r requirements.txt
Start Command: cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT
Health Check Path: /api/health
```

环境变量：

```env
POCKET_LEDGER_DB_PATH=data/pocket_ledger.db
PYTHON_VERSION=3.11.9
OPENAI_COMPATIBLE_BASE_URL=https://api.groq.com/openai/v1
OPENAI_COMPATIBLE_MODEL=qwen/qwen3.6-27b
OPENAI_COMPATIBLE_API_KEY=<Render Secret>
AI_REQUEST_TIMEOUT_SECONDS=10
RUNTIME_AI_SETTINGS_WRITABLE=false
SEED_DEMO_DATA=true
CORS_ALLOWED_ORIGINS=https://pocket-ledger-ai.vercel.app
```

当前线上未配置 `BACKUP_OPENAI_COMPATIBLE_*`。代码支持备用 Provider，但只有独立验证延迟和结构化输出后才应加入；否则主接口失败后会串行等待慢接口，反而破坏演示体验。

`render.yaml` 不会替已经手工创建的服务自动补齐 Secret 或新增变量。更新代码后仍需在 Render Dashboard 的 Environment 页面确认主模型 Key、`RUNTIME_AI_SETTINGS_WRITABLE=false`，并按用途决定 `SEED_DEMO_DATA=true|false`。

公开部署关闭设置写入，原因是项目没有登录系统。CORS 只能限制浏览器来源，不能代替身份认证。

公开演示可设置 `SEED_DEMO_DATA=true`，个人账本应保持 `false`。开启后仅在空数据库第一次初始化时写入演示流水，并记录 `demo_seed_completed=true`；用户随后删除全部流水，重启服务也不会再次补回。

## SQLite 持久化

免费实例不挂载持久磁盘时：

```env
POCKET_LEDGER_DB_PATH=data/pocket_ledger.db
```

数据可以跨页面刷新保留，但重新部署或实例重建后可能重置。若升级到支持磁盘的实例：

```text
Mount Path: /var/data
```

```env
POCKET_LEDGER_DB_PATH=/var/data/pocket_ledger.db
```

README 和演示中必须把免费线上版本描述为“演示级持久化”，不能承诺永久保存。

`ai_advice_cache` 与账单、预算使用同一个 SQLite 文件，后端启动时通过 `init_db()` 自动创建，不需要在 Render 手动执行迁移。免费实例重建时，账单和已生成点评都可能一起重置。

后端业务时区固定为 `Asia/Shanghai`。`requirements.txt` 包含 Windows 所需的 `tzdata`，Render 与本地都会把交易时间保存为带 `+08:00` 的 ISO 8601；月度、周度和日期范围查询按北京时间日期处理。

## Vercel 前端

```text
Root Directory: frontend
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

环境变量：

```env
VITE_API_BASE_URL=https://pocket-ledger-ai.onrender.com
```

根目录 `frontend/vercel.json` 会把前端路径回退到 `index.html`。

## 发布顺序

1. 推送 GitHub `main`。
2. 等待 Render 后端部署完成。
3. 检查 `/api/health` 和 `/api/settings/public`。
4. 确认 Render Secret 和只读设置变量。
5. 等待 Vercel 自动部署。
6. 从 Vercel 域名完成快记、点评、设置和 CORS 检查。

若某次提交只修改 `frontend/` 和文档，Vercel 部署该提交即可，Render 无需手动重新部署。只有后端接口、数据库结构或服务器配置变化时，才要确认 Render 也上线同一或兼容提交。

## 线上验证

```text
GET /api/health
→ {"ok": true}
```

```text
GET /api/settings/public
→ primary_api_key_configured: true
→ primary_model: qwen/qwen3.6-27b
→ backup_enabled: false
→ runtime_settings_writable: false
```

设置页应显示“线上只读”。AI 快记和财务点评应至少一次显示“主模型”；点评生成后重新打开页面应命中 SQLite 缓存，新增流水后应显示“待更新”。2026-07-13 最终验收基线为：健康接口 170 ms、Groq 服务端测试 917 ms、普通快记 3.64 秒、汉字金额快记 4.87 秒、结构化月度点评 5.25 秒。

## 常见故障

### 首次访问等待较久

Render 免费实例闲置后会休眠。前端超过约 1.2 秒显示“连接时间比平时稍长”，通常等待后可恢复。

### Failed to fetch

依次检查：

1. https://pocket-ledger-ai.onrender.com/api/health 是否可访问。
2. Vercel 的 `VITE_API_BASE_URL` 是否为 Render 域名。
3. Render 的 `CORS_ALLOWED_ORIGINS` 是否为 Vercel 域名。
4. 修改 Vercel 环境变量后是否重新部署。

### pydantic-core / maturin 构建失败

日志显示 Python 3.14 和 `metadata-generation-failed` 时，确认 `.python-version` 与 Render 环境变量都锁定 `3.11.9`。

### 设置页显示 Key 未配置

公开部署不依赖 SQLite 中的网页设置。直接检查 Render Environment 中的 Key、Base URL 和模型名，然后重新部署。

Groq 模型 ID 必须包含命名空间：`qwen/qwen3.6-27b`。误写成 `qwen3.6-27b` 时会返回 `HTTP 404 model_not_found`；这表示模型名或权限错误，不是 Key 未读取。

### 保存设置返回 403

这是公开演示的预期安全行为。需要网页保存时，在本地 `.env` 设置：

```env
RUNTIME_AI_SETTINGS_WRITABLE=true
```

### 备用模型没有触发

备用模型只在主模型超时、网络错误、响应异常或字段校验失败时触发。用户输入缺字段或置信度较低不等于服务故障。

### AI 测试明显慢于健康检查

设置页的 `latency_ms` 在 Render 后端内部计时，不包含浏览器网络。若 `/api/health` 很快而 Provider 测试很慢，瓶颈在 Render 到模型平台的链路或模型推理，不应继续调整前端。更换 Provider 后必须同时验证连接测试和真实快记，因为连接成功不等于返回内容一定能通过 JSON 解析。
