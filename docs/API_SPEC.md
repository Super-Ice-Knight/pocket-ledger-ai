# API 规格

## 通用约定

- 后端地址：`http://localhost:8000`
- 时间格式：ISO 8601 字符串
- 金额格式：统一使用 `amount_cents`，单位为分，类型为整数

## POST /api/ai/parse-transaction

请求：

```json
{
  "text": "今天中午和室友吃疯狂星期四花了 50 块，微信付的"
}
```

响应：

```json
{
  "amount_cents": 5000,
  "type": "expense",
  "category": "餐饮",
  "account": "微信",
  "occurred_at": "2026-07-12T12:00:00",
  "note": "疯狂星期四",
  "raw_text": "今天中午和室友吃疯狂星期四花了 50 块，微信付的",
  "tags": [],
  "confidence": 0.95,
  "source": "model",
  "provider": "primary",
  "missing_fields": [],
  "needs_review": true
}
```

本地兜底优先识别带“元、块、¥”的金额，再识别“花了、收入、报销、共、合计”等语境。日期、时间和“3杯、2件”等数量不会作为金额；仍有歧义时返回 `amount_cents=0` 并把 `amount_cents` 加入 `missing_fields`。

当前模型链路已实测把“两千元”解析为 200000 分，但确定性本地兜底只保证阿拉伯数字。该接口一次只返回一个 `ParseResult`，因此一句话应对应一笔交易；同时包含收入和支出的文本需要拆成两次请求，不能在解析阶段直接抵消。

分类会归一化到餐饮、饮品、交通、娱乐、学习、购物、住房、医疗、兼职、收入或其他；账户会归一化到微信、支付宝、银行卡、现金或未指定。

## POST /api/transactions

创建账单。请求体字段：

```json
{
  "amount_cents": 5000,
  "type": "expense",
  "category": "餐饮",
  "account": "微信",
  "occurred_at": "2026-07-12T12:00:00",
  "note": "疯狂星期四",
  "raw_text": "今天中午和室友吃疯狂星期四花了 50 块，微信付的",
  "tags": ["社交", "高频"]
}
```

## GET /api/transactions

查询账单，支持 `month`、`type`、`category`、`account` 参数。

## PUT /api/transactions/{id}

更新账单。

## DELETE /api/transactions/{id}

删除账单。

## GET /api/stats/monthly

查询月度统计，参数 `month=YYYY-MM`。

## POST /api/budgets

设置月度预算。

## GET /api/ai/monthly-advice

根据月度统计和预算生成 AI 财务分析，参数：

- `month=YYYY-MM`
- `tone=sharp` 或 `tone=warm`

返回：

```json
{
  "tone": "sharp",
  "advice": "预算进入警戒区",
  "headline": "预算进入警戒区",
  "detail": "本月支出 301 元，预算使用 17%，剩余约 1498 元。最高分类是学习，主要账户是支付宝，日均支出约 301 元。别被低价小单偷走预算。",
  "action_items": ["继续保持记录", "每周复盘分类", "留意小额高频"],
  "source": "model",
  "provider": "primary"
}
```

`advice` 保留为一句话摘要，便于旧前端兼容；新界面主要使用 `headline`、`detail` 和 `action_items`。模型调用和 AI 快记共用同一套 OpenAI 兼容 Provider 链。所有已配置 Provider 都失败时，后端用预算使用率、最高分类、主要账户、日均支出等本地统计生成结构化兜底分析。

## GET /api/settings/public

返回后端当前非敏感配置状态，不返回 API Key。

```json
{
  "openai_base_url": "https://api.groq.com/openai/v1",
  "openai_model": "qwen/qwen3.6-27b",
  "api_key_configured": true,
  "primary_base_url": "https://api.groq.com/openai/v1",
  "primary_model": "qwen/qwen3.6-27b",
  "primary_api_key_configured": true,
  "backup_base_url": "",
  "backup_model": "",
  "backup_api_key_configured": false,
  "backup_enabled": false,
  "ai_request_timeout_seconds": 10,
  "database_file": "pocket_ledger.db",
  "runtime_settings_writable": false
}
```

## PUT /api/settings/ai

保存真实 AI 运行配置。本地默认 `RUNTIME_AI_SETTINGS_WRITABLE=true`，密钥保存在 SQLite 的 `app_settings` 表中；响应只返回是否已配置，不回显真实 Key。

请求：

```json
{
  "primary_base_url": "https://api.groq.com/openai/v1",
  "primary_model": "qwen/qwen3.6-27b",
  "primary_api_key": "<primary-secret>",
  "backup_base_url": "",
  "backup_model": "",
  "backup_api_key": "",
  "ai_request_timeout_seconds": 10
}
```

如果 `primary_api_key` 或 `backup_api_key` 为空，后端会保留已有 Key。调用模型时先尝试主接口；只有完整配置备用接口时才继续尝试备用 Provider，全部失败后进入 `error_fallback`。当前公开部署为 Groq 单主模型加本地兜底，避免已知慢接口串行增加等待。

公开 Render 演示应设置 `RUNTIME_AI_SETTINGS_WRITABLE=false`。此时接口返回：

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "detail": "线上演示环境不允许修改 AI 配置"
}
```

## POST /api/settings/ai/test

测试当前已保存的主/备 AI 接口连接状态，不返回 API Key。这个接口用于设置页现场验证，避免只显示“已配置”但不知道模型是否真的可用。

请求：

```json
{
  "slot": "primary"
}
```

`slot` 可选值：`all`、`primary`、`backup`。

响应：

```json
[
  {
    "provider": "primary",
    "configured": true,
    "ok": true,
    "base_url": "https://api.groq.com/openai/v1",
    "model": "qwen/qwen3.6-27b",
    "latency_ms": 917,
    "message": "连接成功"
  }
]
```

`latency_ms` 在 FastAPI 后端内部包围模型请求计时，用于区分浏览器网络、Render 服务响应和外部 Provider 延迟。连接测试只证明请求成功；真实快记还会继续执行 JSON 解析、字段归一化和 Pydantic 校验。Groq Qwen 请求使用 `reasoning_effort=none` 控制交互延迟；若兼容模型在 JSON 外附带思考文本或代码围栏，后端使用 `json.JSONDecoder` 提取第一个合法对象，再进入字段校验。
