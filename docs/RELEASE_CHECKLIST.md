# 最终发布检查表

已提交验证基线：`38f91ab`（2026-07-13）。当前待提交工作区在此基础上补充歧义输入确认，勾选项必须有自动化、浏览器、线上接口或仓库检查证据；录制前动作仍保持未勾选。

## 固定入口

- [x] 前端：https://pocket-ledger-ai.vercel.app/
- [x] 后端：https://pocket-ledger-ai.onrender.com/
- [x] 健康检查：https://pocket-ledger-ai.onrender.com/api/health
- [x] API 文档：https://pocket-ledger-ai.onrender.com/docs
- [x] GitHub：https://github.com/Super-Ice-Knight/pocket-ledger-ai

## 自动验证

- [x] `cd backend && .\.venv\Scripts\python.exe -m pytest -q`：35 项通过
- [x] `cd frontend && npm run build` 通过
- [x] `cd frontend && npm test`：7 项 Playwright 通过
- [x] `git diff --check` 无错误
- [x] 仓库不包含 `.env`、`.db`、`.venv`、`node_modules`、`dist`
- [x] GitHub 中不存在真实 Key 或本机绝对路径

当前本地基线：35 项后端测试、7 项 Playwright 测试、前端生产构建全部通过。

2026-07-13 提交 `38f91ab` 的本地 Agent 验收：29 项 pytest、5 项 Playwright 与 Vite 生产构建通过；`1440×900` 与 `390×844` 六个页面无横向溢出；跨月周 `2026/6/29 - 7/5` 的周期统计与日期范围明细一致；交易时间可编辑并按北京时间保存；快速切月和切周都只允许最后一次请求更新页面。

2026-07-14 当前工作区复验：35 项 pytest、7 项 Playwright、Vite 生产构建与 `git diff --check` 通过；新增覆盖多个金额、数量与金额并存、外币、千位分隔符、明确日期、冲突收支类型，以及用户显式确认“其他”分类。线上检查仍以本表“线上行为”部分为准。

## Render 环境变量

- [x] `PYTHON_VERSION=3.11.9`
- [x] `OPENAI_COMPATIBLE_BASE_URL=https://api.groq.com/openai/v1`
- [x] `OPENAI_COMPATIBLE_MODEL=qwen/qwen3.6-27b`
- [x] `OPENAI_COMPATIBLE_API_KEY` 已通过 Secret 填写，公开响应只显示已配置状态
- [x] `BACKUP_OPENAI_COMPATIBLE_*` 未配置，`backup_enabled=false`
- [x] `AI_REQUEST_TIMEOUT_SECONDS=10`
- [x] `RUNTIME_AI_SETTINGS_WRITABLE=false`
- [ ] `SEED_DEMO_DATA=true`（公开演示）或 `false`（个人账本）
- [x] `CORS_ALLOWED_ORIGINS=https://pocket-ledger-ai.vercel.app`

## 线上行为

- [x] `/api/health` 返回 200
- [x] `/api/settings/public` 显示 `runtime_settings_writable=false`
- [x] 设置页显示“线上只读”，不能输入或保存 Key
- [x] Groq 主接口测试成功，响应不包含 Key
- [x] AI 快记至少一次显示“主模型”
- [x] AI 财务点评至少一次显示真实 provider
- [x] 重新打开点评时命中 SQLite 缓存，不重复调用 Provider
- [x] 新增流水或修改预算后显示“待更新”，只有手动重新分析才调用模型
- [ ] 所有已配置 Provider 不可用时测试返回 `error_fallback`
- [x] Vercel 无 CORS 或 `Failed to fetch` 错误
- [x] 冷启动期间显示“连接时间比平时稍长”，不会闪现零统计
- [x] `/api/stats/weekly` 按周一到周日返回统计，跨月周不截断

2026-07-13 单次线上验收样本（不是 SLA）：健康检查、Groq 主模型快记、汉字金额解析和结构化月度点评均成功。详细延迟数据只保留在 `AI_LOG.md` 与 `docs/DEFENSE_NOTES.md`。

## 核心流程

- [x] 输入 `50.` 时文本保留并提示补全
- [x] 输入 `12.60` 后提交值为 1260 分
- [x] 输入 `0`、`0.00` 时显示明确错误且确认按钮禁用
- [x] 输入超过 `99,999,999.99` 元时前后端均拒绝
- [x] “7月11日买3杯咖啡花50元”识别为 5000 分
- [x] 缺金额输入进入 `missing_fields`
- [x] 多个金额、外币和千位分隔符不由本地规则强猜，进入人工确认
- [x] 本地规则无法确定明确日期或收支类型时，对应字段留空且阻止直接保存
- [x] AI 未识别分类时，用户可显式选择“其他”后保存
- [x] AI 推断的交易时间在确认表单中可见且可修改
- [x] 编辑流水可以修改交易时间；跨日、跨周或跨月后统计随之改变
- [x] 修改已解析的原始描述后显示“待重新解析”，旧草稿不能提交
- [x] 编辑模式可取消，取消不产生数据库写入
- [x] 产品约定一条快记只生成一笔账；同时包含收入和支出的描述不在本地兜底中自动抵消
- [x] 确认入账后流水更新
- [x] 流水可切换按月/按周，周期收入、支出、净额和笔数与明细一致
- [x] 删除前出现确认对话框，取消后数据不变
- [x] 图表旁存在分类、账户、日均和预算文字
- [x] 分析页账户图例名称、比例和金额不发生单字断行

## 浏览器尺寸

- [x] `1440×900`：六个页面布局完整
- [x] `1280×720` 长设置页：侧栏底板与主工作区等高，滚动到底部时导航仍在视口内
- [x] `1024px`：桌面侧栏改为上下布局，表单和测试结果无挤压
- [x] `390×844`：无横向溢出
- [x] 手机首屏可看到快记输入框和解析按钮
- [x] 手机快记标题完整显示“AI 解析语义，手动确认入账”，不出现单字断行
- [x] 手机底部五项导航可点击，设置从顶部齿轮进入
- [x] 键盘焦点清晰，月份选择有可访问名称

## 文档

- [x] README 链接和截图与 `38f91ab` 当前界面一致
- [x] AI_LOG 包含两个核心 Prompt、真实 Debug、提交索引和验收证据
- [x] DEFENSE_NOTES 能解释金额、AI 点评缓存、SQLite、设置安全和冷启动
- [x] API_SPEC 包含月/周流水、点评 GET/POST 契约、`fresh/stale/missing`、只读设置字段与 403 行为
- [ ] DEMO_SCRIPT 可在三分钟内完成
- [x] 文档中的相对链接均可解析，无过期占位内容

## 录制前

- [ ] 先唤醒 Render
- [ ] 先测试真实模型
- [ ] 准备三个备用输入
- [ ] 关闭包含 Key、账单隐私或后台控制台的窗口
- [ ] 视频中能看清 provider、金额、月/周切换、日期分组和预算建议
