from __future__ import annotations

from datetime import datetime, timedelta
import json
import re
from time import perf_counter
import httpx
from .runtime_settings import AiProvider, get_runtime_ai_settings
from .money import parse_yuan_to_cents, MoneyParseError
from .schemas import ParseResult, AdviceTone, AiProviderTestResult, AiProviderTestSlot


CATEGORY_KEYWORDS = {
    "餐饮": ["吃", "饭", "餐", "咖啡", "奶茶", "疯狂星期四", "食堂", "外卖", "早餐", "午餐", "晚餐"],
    "交通": ["地铁", "公交", "打车", "出租", "高铁", "火车", "机票", "共享单车"],
    "娱乐": ["电影", "游戏", "演唱会", "ktv", "KTV", "娱乐", "会员"],
    "学习": ["书", "课程", "资料", "考试", "网课", "打印", "文具"],
    "购物": ["买", "购物", "衣服", "鞋", "生活用品", "日用品"],
    "住房": ["房租", "水电", "物业", "宿舍"],
    "医疗": ["药", "医院", "挂号", "体检"],
    "收入": ["收入", "工资", "兼职", "奖学金", "报销", "转入"],
}

ACCOUNT_KEYWORDS = {
    "微信": ["微信", "wx"],
    "支付宝": ["支付宝", "花呗", "余额宝"],
    "银行卡": ["银行卡", "银行", "信用卡", "储蓄卡"],
    "现金": ["现金"],
}

CATEGORY_ALIASES = {
    "book": "学习",
    "books": "学习",
    "书籍": "学习",
    "书本": "学习",
    "课程资料": "学习",
    "资料": "学习",
    "food": "餐饮",
    "meal": "餐饮",
    "drink": "餐饮",
    "drinks": "餐饮",
    "beverage": "餐饮",
    "饮品": "餐饮",
    "transport": "交通",
    "transportation": "交通",
    "shopping": "购物",
    "medical": "医疗",
}

ACCOUNT_ALIASES = {
    "wechat": "微信",
    "wechat pay": "微信",
    "weixin": "微信",
    "wx": "微信",
    "微信支付": "微信",
    "alipay": "支付宝",
    "支付宝支付": "支付宝",
    "bank": "银行卡",
    "bank card": "银行卡",
    "card": "银行卡",
    "cash": "现金",
}


def local_parse(text: str) -> ParseResult:
    missing: list[str] = []
    occurred_at = detect_occurred_at(text)
    try:
        amount_cents = parse_yuan_to_cents(text)
    except MoneyParseError:
        amount_cents = 0
        missing.append("amount_cents")
    category = detect_category(text)
    account = detect_account(text)
    tx_type = "income" if category == "收入" or any(word in text for word in ["收入", "工资", "兼职", "奖学金", "报销"]) else "expense"
    note = build_note(text, category, account)
    if category == "其他":
        missing.append("category")
    if account == "未指定":
        missing.append("account")
    return ParseResult(
        amount_cents=amount_cents,
        type=tx_type,
        category=category,
        account=account,
        occurred_at=occurred_at,
        note=note,
        raw_text=text,
        confidence=0.86 if not missing else 0.52,
        source="local_rule",
        provider="local",
        missing_fields=missing,
        needs_review=True,
    )


def detect_category(text: str) -> str:
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            return "餐饮" if category == "收入" and "花" in text else category
    return "其他"


def detect_account(text: str) -> str:
    for account, keywords in ACCOUNT_KEYWORDS.items():
        if any(keyword.lower() in text.lower() for keyword in keywords):
            return account
    return "未指定"


def normalize_category(value: object, fallback: str) -> str:
    category = str(value or "").strip()
    if not category:
        return fallback
    if category in CATEGORY_KEYWORDS or category in ["兼职", "其他"]:
        return category
    return CATEGORY_ALIASES.get(category.lower(), CATEGORY_ALIASES.get(category, category))


def normalize_account(value: object, fallback: str) -> str:
    account = str(value or "").strip()
    if not account:
        return fallback
    if account in ACCOUNT_KEYWORDS:
        return account
    return ACCOUNT_ALIASES.get(account.lower(), ACCOUNT_ALIASES.get(account, account))


def build_note(text: str, category: str, account: str) -> str:
    cleaned = text
    cleaned = re.sub(r"\d+(?:\.\d+)?\s*(元|块|rmb|RMB)?", "", cleaned)
    for word in [category, account, "今天", "昨天", "中午", "晚上", "早上", "付的", "花了", "消费", "支出", "收入"]:
        cleaned = cleaned.replace(word, "")
    cleaned = re.sub(r"[，。,.\s]+", " ", cleaned).strip()
    return cleaned[:40] or category


def has_relative_date(text: str) -> bool:
    return any(word in text for word in ["今天", "今日", "昨天", "昨日", "前天"])


def detect_occurred_at(text: str) -> datetime:
    now = datetime.now().replace(microsecond=0)
    if "前天" in text:
        return now - timedelta(days=2)
    if "昨天" in text or "昨日" in text:
        return now - timedelta(days=1)
    return now


async def parse_with_model(text: str) -> ParseResult:
    runtime = get_runtime_ai_settings()
    providers = runtime.configured_providers()
    if not providers:
        return local_parse(text)
    now = datetime.now().replace(microsecond=0).isoformat()
    prompt = (
        "你是记账系统的结构化解析器。只返回 JSON, 不要解释。"
        f"当前本地时间是 {now}。遇到今天、昨天、前天等相对日期, 必须以当前本地时间换算。"
        "字段: amount_cents(int), type(expense|income), category, account, occurred_at(ISO), note, "
        "tags(array), confidence(0-1), missing_fields(array)。金额必须转换为分。tags 用于用户自定义标签, 不确定则返回空数组。"
    )
    for provider in providers:
        try:
            content = await request_chat_completion(
                provider=provider,
                timeout=runtime.ai_request_timeout_seconds,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": text},
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
            )
            parsed = json.loads(content)
            local = local_parse(text)
            occurred_at = local.occurred_at if has_relative_date(text) else parsed.get("occurred_at") or local.occurred_at
            return ParseResult(
                amount_cents=int(parsed.get("amount_cents") or local.amount_cents),
                type=parsed.get("type") or local.type,
                category=normalize_category(parsed.get("category"), local.category),
                account=normalize_account(parsed.get("account"), local.account),
                occurred_at=occurred_at,
                note=parsed.get("note") or local.note,
                raw_text=text,
                tags=parsed.get("tags") or local.tags,
                confidence=float(parsed.get("confidence") or 0.78),
                source="model",
                provider=provider.slot,
                missing_fields=parsed.get("missing_fields") or [],
                needs_review=True,
            )
        except Exception:
            continue
    fallback = local_parse(text)
    fallback.source = "error_fallback"
    fallback.provider = "fallback"
    return fallback


async def request_chat_completion(
    provider: AiProvider,
    timeout: int,
    messages: list[dict[str, str]],
    temperature: float,
    response_format: dict | None = None,
) -> str:
    payload = {
        "model": provider.model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        payload["response_format"] = response_format
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{provider.base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {provider.api_key}"},
            json=payload,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


async def test_ai_providers(slot: AiProviderTestSlot = "all") -> list[AiProviderTestResult]:
    runtime = get_runtime_ai_settings()
    providers = {provider.slot: provider for provider in runtime.configured_providers()}
    slots: list[str] = ["primary", "backup"] if slot == "all" else [slot]
    results: list[AiProviderTestResult] = []
    for provider_slot in slots:
        provider = providers.get(provider_slot)
        if provider is None:
            base_url = runtime.primary_base_url if provider_slot == "primary" else runtime.backup_base_url
            model = runtime.primary_model if provider_slot == "primary" else runtime.backup_model
            results.append(
                AiProviderTestResult(
                    provider=provider_slot,
                    configured=False,
                    ok=False,
                    base_url=base_url,
                    model=model,
                    latency_ms=0,
                    message="未配置 API Key、Base URL 或模型名",
                )
            )
            continue
        start = perf_counter()
        try:
            await request_chat_completion(
                provider=provider,
                timeout=runtime.ai_request_timeout_seconds,
                messages=[
                    {"role": "system", "content": "只返回 JSON。"},
                    {"role": "user", "content": '返回 {"ok": true} 用于连接测试。'},
                ],
                response_format={"type": "json_object"},
                temperature=0,
            )
            results.append(
                AiProviderTestResult(
                    provider=provider.slot,
                    configured=True,
                    ok=True,
                    base_url=provider.base_url,
                    model=provider.model,
                    latency_ms=round((perf_counter() - start) * 1000),
                    message="连接成功",
                )
            )
        except Exception as exc:
            results.append(
                AiProviderTestResult(
                    provider=provider.slot,
                    configured=True,
                    ok=False,
                    base_url=provider.base_url,
                    model=provider.model,
                    latency_ms=round((perf_counter() - start) * 1000),
                    message=describe_provider_error(exc),
                )
            )
    return results


def describe_provider_error(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        body = exc.response.text[:160] if exc.response is not None else ""
        return f"HTTP {exc.response.status_code}: {body}"
    message = str(exc).strip() or exc.__class__.__name__
    return f"{exc.__class__.__name__}: {message[:160]}"


async def monthly_advice(stats: dict, tone: AdviceTone) -> dict:
    runtime = get_runtime_ai_settings()
    providers = runtime.configured_providers()
    fallback = local_advice(stats, tone)
    if not providers:
        return {"tone": tone, "advice": fallback, "source": "local_rule", "provider": "local"}
    for provider in providers:
        try:
            advice = await request_chat_completion(
                provider=provider,
                timeout=runtime.ai_request_timeout_seconds,
                messages=[
                    {"role": "system", "content": "你是个人财务建议助手。输出一句 40 字以内的中文建议。不要编造数字。"},
                    {"role": "user", "content": json.dumps({"stats": stats, "tone": tone}, ensure_ascii=False)},
                ],
                temperature=0.5,
            )
            return {"tone": tone, "advice": advice.strip()[:80], "source": "model", "provider": provider.slot}
        except Exception:
            continue
    return {"tone": tone, "advice": fallback, "source": "error_fallback", "provider": "fallback"}


def local_advice(stats: dict, tone: AdviceTone) -> str:
    usage = stats.get("budget_usage_ratio", 0)
    expense = stats.get("expense_cents", 0) / 100
    if not stats.get("budget_limit_cents"):
        return "先设一个月度预算，不然消费复盘只能靠感觉。"
    if usage >= 1:
        return f"本月已经花到 {expense:.0f} 元，预算线被你踩过去了，接下来每一笔都要问值不值。" if tone == "sharp" else "本月已经超出预算，建议先暂停非必要消费，把剩余额度留给刚需。"
    if usage >= 0.8:
        return "预算快见底了，奶茶和随机购物先收一收，别让月底变成求生模式。" if tone == "sharp" else "预算使用已接近上限，接下来优先保留餐饮、交通等必要支出。"
    return "节奏还稳，但别被低价小单偷走预算，零碎消费最会伪装。" if tone == "sharp" else "本月预算状态健康，可以继续保持记录和每周复盘。"
