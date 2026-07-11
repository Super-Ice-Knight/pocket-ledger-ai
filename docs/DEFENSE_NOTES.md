# 答辩备忘

## 为什么选择前后端分离

前端负责交互和产品观感，后端负责数据库、AI 接口和数据校验。这样结构清楚，也便于解释每层代码的职责。

## 为什么使用 SQLite

SQLite 是嵌入式数据库，数据存在一个 `.db` 文件里，不需要启动 MySQL 这类数据库服务。对于单用户演示项目，它足够稳定，也能体现真实数据持久化。

## 为什么金额存整数分

JavaScript 和 Python 的浮点数都可能出现精度误差。货币计算不能直接依赖 float，所以系统把 50 元存为 5000 分，19.9 元存为 1990 分。

## AI 为什么不能直接入账

AI 解析自然语言可能出错。系统只把 AI 输出作为待确认草稿，用户确认后才写入数据库。

## API 挂了怎么办

后端捕获 AI 调用异常，并使用本地规则解析作为兜底。前端也保留手动录入能力。

这里要区分三种状态：

- `model`：已经调用真实 AI 接口。
- `local_rule`：没有配置 Key 或模型名还是默认值，系统主动走本地规则。
- `error_fallback`：Key 已配置，但接口超时、网络失败或模型返回异常，系统临时回落到本地规则。

系统支持主接口和备用接口。调用顺序是先请求主模型；如果主模型超时、网络失败或返回异常，再请求备用模型；主备都失败才进入 `error_fallback`。Agnes 这类中转接口偶尔响应较慢，所以后端提供 `AI_REQUEST_TIMEOUT_SECONDS` 控制超时时间，本机当前设为 45 秒。

设置页还有“测试主备接口”按钮，会调用 `POST /api/settings/ai/test`。这个接口只返回通断、模型名、Base URL、耗时和简短错误，不返回 Key。它的作用是让答辩现场能证明主/备模型不是摆设。

## AI 财务点评怎么实现

AI 财务点评和 AI 快记共用同一套主备模型调用链。后端接口是 `GET /api/ai/monthly-advice`，会把本月收入、支出、预算、分类占比、账户分布、每日趋势和最近流水整理成 `stats` 发给模型。

系统内置了角色设定 Prompt：模型被设定为“口袋记账 AI 版”的个人财务分析师，面向学生和年轻用户，要求基于账单统计说清楚钱花在哪里、预算风险在哪里、下一步怎么做。`tone=sharp` 时可以直接、有一点毒舌但不能羞辱用户；`tone=warm` 时要温和具体。

模型必须返回固定 JSON：

```json
{
  "headline": "一句话结论",
  "detail": "详细分析",
  "action_items": ["行动建议1", "行动建议2"]
}
```

前端把 `headline` 放在一句话分析区域，把 `detail` 放在详细分析区域，把 `action_items` 放在预算建议区。旧字段 `advice` 保留为一句话摘要，避免接口兼容问题。

本地兜底不是随机语录库，也不是权重抽取。它是确定性规则分析：根据是否设置预算、预算使用率、最高支出分类、主要支付账户、日均支出和剩余额度，组合生成同样结构的 `headline/detail/action_items`。这样即使模型不可用，界面仍然有可解释的分析结果。

## 本地兜底到底怎么实现

本地兜底不是另一个小模型，而是确定性规则解析：

- 金额：调用 `parse_yuan_to_cents`，用正则从句子里找金额，再用 `Decimal` 转成整数分。
- 分类：在 `CATEGORY_KEYWORDS` 中查关键词，例如“吃、饭、咖啡、疯狂星期四”归为餐饮。
- 账户：在 `ACCOUNT_KEYWORDS` 中查关键词，例如“微信、支付宝、银行卡、现金”。
- 类型：如果分类是收入，或句子里出现“工资、兼职、奖学金、报销”等词，就标为收入，否则标为支出。
- 备注：从原句里去掉金额、时间词、账户词和常见动词，保留剩余短语。
- 置信度：金额、分类、账户都识别出来时为 `0.86`；缺字段时为 `0.52`，并写入 `missing_fields`。

这套规则的好处是可解释、可测试、演示不依赖外部 API。缺点是覆盖面有限，所以界面始终要求用户确认。

## 自定义标签怎么存

前端提交 `tags: string[]`。后端用 Pydantic 去空、去重、限制长度，然后在 SQLite 的 `tags TEXT` 字段里保存 JSON 数组。第一版不做复杂标签检索，因此不单独建标签表。

## 为什么要做模型结果归一化

不同模型会用不同字段习惯，例如备用模型可能返回 `books`、`书籍`、`alipay`、`微信支付`。这些值如果直接进入前端，会和分类/账户下拉框不一致。后端在写入 `ParseResult` 前会做轻量归一化，例如 `books/书籍 -> 学习`、`alipay -> 支付宝`、`微信支付 -> 微信`。这属于工程兜底，不是让 AI 决定系统字段体系。

## 设置面板怎么处理 API Key

`.env` 提供初始默认配置和部署兜底。网页设置页已经是真实设置，会调用 `PUT /api/settings/ai` 把主接口、备用接口、Key 和超时时间保存到本地 SQLite 的 `app_settings` 表。后端下一次调用 AI 时直接读取这张表，不需要重启。

为了避免泄露，`GET /api/settings/public` 和保存后的响应都不会返回真实 Key，只返回 `primary_api_key_configured`、`backup_api_key_configured` 和 `backup_enabled` 这类布尔状态。设置页里的 Key 输入框留空时表示保留原有 Key。

`POST /api/settings/ai/test` 也不会返回 Key。即使连接失败，错误信息会控制在短文本内，用于判断模型名错误、网络失败或平台返回异常。

`.env` 是一个没有普通文件名前缀的环境变量文件，文件名就叫 `.env`，不是 `.env.txt`。每一行是 `变量名=变量值`，例如：

```env
OPENAI_COMPATIBLE_BASE_URL=https://apihub.agnes-ai.com/v1
OPENAI_COMPATIBLE_MODEL=agnes-2.0-flash
OPENAI_COMPATIBLE_API_KEY=你的真实密钥
BACKUP_OPENAI_COMPATIBLE_BASE_URL=https://api.siliconflow.cn/v1
BACKUP_OPENAI_COMPATIBLE_MODEL=deepseek-ai/DeepSeek-V4-Pro
BACKUP_OPENAI_COMPATIBLE_API_KEY=你的备用密钥
AI_REQUEST_TIMEOUT_SECONDS=45
```

修改 `.env` 后必须重启后端，因为 FastAPI 进程启动时才读取环境变量；通过网页设置保存则不需要重启。

当前本机为了避开 8000 端口异常残留，后端运行在 `http://127.0.0.1:8001`，前端通过 `frontend/.env.local` 的 `VITE_API_BASE_URL=http://127.0.0.1:8001` 指向它。

## 能适配哪些 AI API

当前项目适配的是 OpenAI 兼容的 Chat Completions 文本接口。后端会向 `{OPENAI_COMPATIBLE_BASE_URL}/chat/completions` 发送请求，并用 Bearer Token 认证。

因此 Agnes 和硅基流动这类提供 OpenAI 兼容 `/v1/chat/completions` 的平台可以接入。Base URL 必须写到 `/v1` 这一层，因为代码会继续拼接 `/chat/completions`。

## 相对日期怎么处理

模型可能把“今天、昨天、前天”解析成错误日期。系统的处理方式是：

- Prompt 告诉模型当前本地时间。
- 后端本地也识别“今天、昨天、前天”。
- 只要原句含相对日期，最终入账时间以后端本地计算结果为准。
- 这样既能利用模型理解语义，又不把关键时间字段完全交给模型猜。

## 非法输入怎么办

后端用 Pydantic 校验字段，金额必须为非负整数，类型只能是收入或支出。解析缺字段时会返回 `missing_fields`，不会直接入账。

## 为什么线上会出现 Failed to fetch

`Failed to fetch` 不一定是代码坏了，常见原因有三个：

- 前端 `VITE_API_BASE_URL` 指向了错误后端。
- 后端服务没有启动，`/api/health` 不通。
- 后端 CORS 没有允许当前前端域名。

项目把 CORS 做成了环境变量 `CORS_ALLOWED_ORIGINS`。本地默认允许 `localhost:5173` 和 `127.0.0.1:5173`。线上部署后，需要把 Vercel 前端域名写入后端环境变量，否则浏览器会拦截前端请求。
