# 最终发布检查表

## 固定入口

- [ ] 前端：https://pocket-ledger-ai.vercel.app/
- [ ] 后端：https://pocket-ledger-ai.onrender.com/
- [ ] 健康检查：https://pocket-ledger-ai.onrender.com/api/health
- [ ] API 文档：https://pocket-ledger-ai.onrender.com/docs
- [ ] GitHub：https://github.com/Super-Ice-Knight/pocket-ledger-ai

## 自动验证

- [ ] `cd backend && .\.venv\Scripts\python.exe -m pytest -q` 全部通过
- [ ] `cd frontend && npm run build` 通过
- [ ] `git diff --check` 无错误
- [ ] 仓库不包含 `.env`、`.db`、`.venv`、`node_modules`、`dist`
- [ ] GitHub 中不存在真实 Key 或本机绝对路径

最终基线：18 项后端测试，前端生产构建通过。

## Render 环境变量

- [ ] `PYTHON_VERSION=3.11.9`
- [ ] `OPENAI_COMPATIBLE_BASE_URL=https://apihub.agnes-ai.com/v1`
- [ ] `OPENAI_COMPATIBLE_MODEL=agnes-2.0-flash`
- [ ] `OPENAI_COMPATIBLE_API_KEY` 已通过 Secret 填写
- [ ] `BACKUP_OPENAI_COMPATIBLE_BASE_URL=https://api.siliconflow.cn/v1`
- [ ] `BACKUP_OPENAI_COMPATIBLE_MODEL=deepseek-ai/DeepSeek-V4-Flash`
- [ ] `BACKUP_OPENAI_COMPATIBLE_API_KEY` 已通过 Secret 填写
- [ ] `AI_REQUEST_TIMEOUT_SECONDS=45`
- [ ] `RUNTIME_AI_SETTINGS_WRITABLE=false`
- [ ] `CORS_ALLOWED_ORIGINS=https://pocket-ledger-ai.vercel.app`

## 线上行为

- [ ] `/api/health` 返回 200
- [ ] `/api/settings/public` 显示 `runtime_settings_writable=false`
- [ ] 设置页显示“线上只读”，不能输入或保存 Key
- [ ] 主备接口测试至少一个成功，响应不包含 Key
- [ ] AI 快记至少一次显示“主模型”或“备用模型”
- [ ] AI 财务点评至少一次显示真实 provider
- [ ] 主备不可用时测试返回 `error_fallback`
- [ ] Vercel 无 CORS 或 `Failed to fetch` 错误
- [ ] 冷启动期间显示“后端正在唤醒”，不会闪现零统计

## 核心流程

- [ ] 输入 `50.` 时文本保留并提示补全
- [ ] 输入 `12.60` 后提交值为 1260 分
- [ ] “7月11日买3杯咖啡花50元”识别为 5000 分
- [ ] 缺金额输入进入 `missing_fields`
- [ ] 确认入账后流水更新
- [ ] 删除前出现确认对话框，取消后数据不变
- [ ] 图表旁存在分类、账户、日均和预算文字

## 浏览器尺寸

- [ ] `1440×900`：六个页面布局完整
- [ ] `390×844`：无横向溢出
- [ ] 手机首屏可看到快记输入框和解析按钮
- [ ] 手机底部五项导航可点击，设置从顶部齿轮进入
- [ ] 键盘焦点清晰，月份选择有可访问名称

## 文档

- [ ] README 链接和截图与当前版本一致
- [ ] AI_LOG 包含两个核心 Prompt、真实 Debug 和验收证据
- [ ] DEFENSE_NOTES 能解释金额、AI、SQLite、设置安全和冷启动
- [ ] API_SPEC 包含只读设置字段与 403 行为
- [ ] DEMO_SCRIPT 可在三分钟内完成
- [ ] 文档没有“后续补充链接”等过期占位

## 录制前

- [ ] 先唤醒 Render
- [ ] 先测试真实模型
- [ ] 准备三个备用输入
- [ ] 关闭包含 Key、账单隐私或后台控制台的窗口
- [ ] 视频中能看清 provider、金额、日期分组和预算建议
