# 发布检查表

## 代码检查

- 后端测试通过：`cd backend && pytest`
- 前端构建通过：`cd frontend && npm run build`
- 浏览器检查通过：桌面端和手机端无明显布局崩坏
- 设置页可以测试主接口和备用接口
- 一句话记账、确认入账、流水更新流程可用

## 安全检查

- 仓库不包含真实 `.env`
- 仓库不包含 SQLite `.db` 文件
- 仓库不包含 `node_modules/`、`.venv/`、`frontend/dist/`
- README、部署文档和演示文档不包含真实 API Key
- 公开接口不回显真实 Key

## GitHub 检查

- README 是评审入口
- `AI_LOG.md` 能体现真实协作，不只是聊天记录
- `docs/API_SPEC.md` 与当前接口一致
- `docs/DEPLOYMENT.md` 包含线上部署路径
- `docs/DEMO_SCRIPT.md` 支持 3 分钟演示

## 线上检查

- 后端 `/api/health` 返回正常
- 前端 `VITE_API_BASE_URL` 指向线上后端
- 后端 `CORS_ALLOWED_ORIGINS` 包含线上前端域名
- 设置页主备模型测试可以返回状态
- 刷新页面后数据持久化符合预期

