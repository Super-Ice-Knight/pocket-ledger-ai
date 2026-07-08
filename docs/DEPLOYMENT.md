# 部署说明

## 推荐部署形态

本项目是前后端分离应用：

- 前端：Vite React 静态站点，推荐部署到 Vercel。
- 后端：FastAPI Web Service，推荐部署到 Render。
- 数据库：SQLite。线上演示需要持久磁盘，否则平台重启后数据可能重置。

本地版本仍然是最完整、最可信的答辩版本；线上版本定位为演示链接。

## GitHub 发布

发布前确认：

```powershell
git status --short
git diff --stat
```

首次发布可以采用：

```powershell
git branch -M main
git remote add origin https://github.com/<your-name>/pocket-ledger-ai.git
git push -u origin main
```

如果使用 GitHub CLI：

```powershell
gh auth login
gh repo create pocket-ledger-ai --private --source=. --remote=origin --push
```

不要提交：

- `.env`
- `.venv/`
- `node_modules/`
- `frontend/dist/`
- SQLite `.db` 文件
- 本机截图输出目录 `output/`

## 后端部署到 Render

可以使用根目录的 `render.yaml` 作为参考，也可以手动创建 Web Service。

手动配置：

```text
Runtime: Python
Build Command: cd backend && pip install -r requirements.txt
Start Command: cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT
Health Check Path: /api/health
```

建议添加持久磁盘：

```text
Mount Path: /var/data
```

后端环境变量：

```env
POCKET_LEDGER_DB_PATH=/var/data/pocket_ledger.db
OPENAI_COMPATIBLE_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_MODEL=your-model-name
BACKUP_OPENAI_COMPATIBLE_API_KEY=
BACKUP_OPENAI_COMPATIBLE_BASE_URL=
BACKUP_OPENAI_COMPATIBLE_MODEL=
AI_REQUEST_TIMEOUT_SECONDS=45
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app
```

`CORS_ALLOWED_ORIGINS` 很重要。前端部署后，需要把 Vercel 域名写进这里，否则浏览器会因为跨域策略拦截请求。

## 前端部署到 Vercel

导入 GitHub 仓库后配置：

```text
Root Directory: frontend
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

前端环境变量：

```env
VITE_API_BASE_URL=https://your-backend-domain.onrender.com
```

部署完成后，回到 Render 后端，把前端域名加入：

```env
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.vercel.app
```

如果同时需要本地和线上前端访问同一个后端，可以逗号分隔：

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://your-frontend-domain.vercel.app
```

## 线上验证

部署后按顺序检查：

1. 打开后端 `/api/health`，应返回 `{"ok": true}`。
2. 打开前端首页，确认没有 `Failed to fetch`。
3. 进入设置页，保存主接口或备用接口。
4. 点击“测试主备接口”，确认能返回连接状态。
5. 输入一句话记账，确认解析、确认入账、流水更新。
6. 刷新页面，确认 SQLite 持久化是否符合预期。

## 常见故障

### Failed to fetch

优先检查三件事：

- 前端 `VITE_API_BASE_URL` 是否指向真实后端域名。
- 后端是否启动，`/api/health` 是否可访问。
- 后端 `CORS_ALLOWED_ORIGINS` 是否包含前端域名。

### 设置页显示 Key 未配置

可能原因：

- 后端环境变量为空。
- 网页设置页保存的配置存在 SQLite，但线上数据库被重置。
- 前端连接到了另一个后端实例。

### 备用模型没有触发

备用模型只在主模型请求失败、超时或返回不可用时触发。低置信度不会自动切换，因为低置信度可能来自用户输入缺字段，而不是模型服务故障。

