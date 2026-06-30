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
  "confidence": 0.82,
  "source": "local_rule",
  "missing_fields": [],
  "needs_review": true
}
```

## POST /api/transactions

创建账单。

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

