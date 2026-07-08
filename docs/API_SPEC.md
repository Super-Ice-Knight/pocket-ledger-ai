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
  "occurred_at": "2026-06-30T12:00:00",
  "note": "疯狂星期四",
  "raw_text": "今天中午和室友吃疯狂星期四花了 50 块，微信付的",
  "tags": [],
  "confidence": 0.82,
  "source": "local_rule",
  "provider": "local",
  "missing_fields": [],
  "needs_review": true
}
```

## POST /api/transactions

创建账单。请求体字段：

```json
{
  "amount_cents": 5000,
  "type": "expense",
  "category": "餐饮",
  "account": "微信",
  "occurred_at": "2026-06-30T12:00:00",
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

根据月度统计和预算生成建议，参数：

- `month=YYYY-MM`
- `tone=sharp` 或 `tone=warm`

## GET /api/settings/public

返回后端当前非敏感配置状态，不返回 API Key。

```json
{
  "openai_base_url": "https://api.openai.com/v1",
  "openai_model": "your-model-name",
  "api_key_configured": false,
  "primary_base_url": "https://api.openai.com/v1",
  "primary_model": "your-model-name",
  "primary_api_key_configured": false,
  "backup_base_url": "https://api.siliconflow.cn/v1",
  "backup_model": "deepseek-ai/DeepSeek-V4-Flash",
  "backup_api_key_configured": false,
  "backup_enabled": false,
  "ai_request_timeout_seconds": 45,
  "database_file": "pocket_ledger.db"
}
```

## PUT /api/settings/ai

保存真实 AI 运行配置。第一版是本地单用户演示，密钥会保存在本地 SQLite 的 `app_settings` 表中；响应仍然只返回是否已配置，不回显真实 Key。

请求：

```json
{
  "primary_base_url": "https://apihub.agnes-ai.com/v1",
  "primary_model": "agnes-2.0-flash",
  "primary_api_key": "sk-...",
  "backup_base_url": "https://api.siliconflow.cn/v1",
  "backup_model": "deepseek-ai/DeepSeek-V4-Flash",
  "backup_api_key": "sk-...",
  "ai_request_timeout_seconds": 45
}
```

如果 `primary_api_key` 或 `backup_api_key` 为空，后端会保留已有 Key。调用模型时先尝试主接口，主接口异常后再尝试备用接口；全部失败才进入 `error_fallback`。

## POST /api/settings/ai/test

测试当前已保存的主/备 AI 接口连接状态，不返回 API Key。这个接口用于设置页现场验证，避免只显示“已配置”但不知道模型是否真的可用。

请求：

```json
{
  "slot": "all"
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
    "base_url": "https://apihub.agnes-ai.com/v1",
    "model": "agnes-2.0-flash",
    "latency_ms": 1200,
    "message": "连接成功"
  },
  {
    "provider": "backup",
    "configured": true,
    "ok": false,
    "base_url": "https://api.siliconflow.cn/v1",
    "model": "deepseek-ai/DeepSeek-V4-Flash",
    "latency_ms": 320,
    "message": "HTTP 400: {\"message\":\"bad model\"}"
  }
]
```
