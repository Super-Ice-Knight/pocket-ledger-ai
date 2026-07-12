from __future__ import annotations

from datetime import datetime, timedelta
import json
import re
from time import perf_counter
from urllib.parse import urlparse
import httpx
from .runtime_settings import AiProvider, get_runtime_ai_settings
from .money import extract_transaction_amount_cents, MoneyParseError
from .schemas import ParseResult, AdviceTone, AiProviderTestResult, AiProviderTestSlot


CATEGORY_KEYWORDS = {
    "饮品": ["咖啡", "奶茶", "饮料", "茶饮", "果汁"],
    "餐饮": ["吃", "饭", "餐", "疯狂星期四", "食堂", "外卖", "早餐", "午餐", "晚餐"],
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
    "drink": "饮品",
    "drinks": "饮品",
    "beverage": "饮品",
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

CANONICAL_CATEGORIES = set(CATEGORY_KEYWORDS) | {"兼职", "其他"}
CANONICAL_ACCOUNTS = set(ACCOUNT_KEYWORDS) | {"未指定"}


def local_parse(text: str) -> ParseResult:
    missing: list[str] = []
    occurred_at = detect_occurred_at(text)
    try:
        amount_cents = extract_transaction_amount_cents(text)
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
    normalized = CATEGORY_ALIASES.get(category.lower(), CATEGORY_ALIASES.get(category, category))
    if normalized in CANONICAL_CATEGORIES:
        return normalized
    return fallback if fallback in CANONICAL_CATEGORIES else "其他"


def normalize_account(value: object, fallback: str) -> str:
    account = str(value or "").strip()
    if not account:
        return fallback
    normalized = ACCOUNT_ALIASES.get(account.lower(), ACCOUNT_ALIASES.get(account, account))
    if normalized in CANONICAL_ACCOUNTS:
        return normalized
    return fallback if fallback in CANONICAL_ACCOUNTS else "未指定"


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
            parsed = decode_json_object(content)
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
    payload = build_chat_completion_payload(
        provider=provider,
        messages=messages,
        temperature=temperature,
        response_format=response_format,
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{provider.base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {provider.api_key}"},
            json=payload,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


def build_chat_completion_payload(
    provider: AiProvider,
    messages: list[dict[str, str]],
    temperature: float,
    response_format: dict | None = None,
) -> dict:
    payload: dict = {
        "model": provider.model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        payload["response_format"] = response_format
    if urlparse(provider.base_url).hostname == "api.groq.com" and provider.model.lower().startswith("qwen/"):
        payload["reasoning_effort"] = "none"
    return payload


def decode_json_object(content: str) -> dict:
    text = str(content).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as first_error:
        decoder = json.JSONDecoder()
        for index, character in enumerate(text):
            if character != "{":
                continue
            try:
                candidate, _ = decoder.raw_decode(text[index:])
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict):
                return candidate
        raise ValueError("模型未返回有效 JSON 对象") from first_error
    if not isinstance(parsed, dict):
        raise ValueError("模型返回的 JSON 不是对象")
    return parsed


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
        return {**fallback, "tone": tone, "source": "local_rule", "provider": "local"}
    for provider in providers:
        try:
            content = await request_chat_completion(
                provider=provider,
                timeout=runtime.ai_request_timeout_seconds,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是“口袋记账 AI 版”的个人财务分析师，服务对象是学生和年轻用户。"
                            "你要像一个克制但有判断力的预算教练：基于账单统计说清楚钱花在哪里、预算风险在哪里、下一步怎么做。"
                            "不要编造输入里没有的数字，不要提供投资建议，不要使用空泛鸡汤。"
                            "tone=sharp 时可以直接、有一点毒舌，但不能羞辱用户；tone=warm 时温和具体。"
                            "只返回 JSON，不要 Markdown。字段必须是："
                            "headline(string, 28字以内，一句话结论), "
                            "detail(string, 120到220字，给出具体财务分析), "
                            "action_items(array, 2到3条，每条24字以内的行动建议)。"
                        ),
                    },
                    {"role": "user", "content": json.dumps({"stats": stats, "tone": tone}, ensure_ascii=False)},
                ],
                response_format={"type": "json_object"},
                temperature=0.45,
            )
            return {
                **normalize_advice_payload(decode_json_object(content), fallback),
                "tone": tone,
                "source": "model",
                "provider": provider.slot,
            }
        except Exception:
            continue
    return {**fallback, "tone": tone, "source": "error_fallback", "provider": "fallback"}


def normalize_advice_payload(payload: dict, fallback: dict) -> dict:
    headline = str(payload.get("headline") or payload.get("advice") or fallback["headline"]).strip()
    detail = str(payload.get("detail") or fallback["detail"]).strip()
    raw_items = payload.get("action_items") or payload.get("actions") or fallback["action_items"]
    if not isinstance(raw_items, list):
        raw_items = fallback["action_items"]
    action_items = [str(item).strip()[:24] for item in raw_items if str(item).strip()][:3]
    if not action_items:
        action_items = fallback["action_items"]
    return {
        "advice": headline[:80],
        "headline": headline[:80],
        "detail": detail[:360],
        "action_items": action_items,
    }


def local_advice(stats: dict, tone: AdviceTone) -> dict:
    usage = stats.get("budget_usage_ratio", 0)
    expense = cents(stats.get("expense_cents", 0))
    income = cents(stats.get("income_cents", 0))
    remaining = cents(stats.get("budget_remaining_cents", 0))
    top_category = first_name(stats.get("category_breakdown"))
    top_account = first_name(stats.get("account_breakdown"))
    active_days = max(len(stats.get("daily_trend") or []), 1)
    daily_average = expense / active_days
    if not stats.get("budget_limit_cents"):
        headline = "先把预算线立起来"
        detail = (
            f"本月已记录支出 {expense:.0f} 元、收入 {income:.0f} 元，但还没有设置月度预算。"
            f"目前最高支出分类是{top_category}，主要付款账户是{top_account}。"
            "没有预算线时，系统只能告诉你钱流向哪里，不能判断节奏是否危险。"
        )
        return advice_payload(headline, detail, ["设置月度预算", "先复盘最高分类", "保持每天记账"])
    if usage >= 1:
        headline = "预算线已经被踩穿"
        detail = (
            f"本月支出 {expense:.0f} 元，已经超过预算，当前剩余额度为 {remaining:.0f} 元。"
            f"最需要盯住的是{top_category}，日均支出约 {daily_average:.0f} 元。"
            + (
                "接下来不是优化体验，是先止血：每一笔非刚需都要问一次值不值。"
                if tone == "sharp"
                else "接下来建议先暂停非必要消费，把额度留给餐饮、交通等刚需。"
            )
        )
        return advice_payload(headline, detail, ["暂停非必要消费", f"压低{top_category}支出", "每天看一次预算"])
    if usage >= 0.8:
        headline = "预算进入警戒区"
        detail = (
            f"预算已使用 {usage:.0%}，本月支出 {expense:.0f} 元，剩余约 {remaining:.0f} 元。"
            f"最高分类是{top_category}，主要账户是{top_account}，日均支出约 {daily_average:.0f} 元。"
            + (
                "现在再放任小额高频消费，月底就会很难看。"
                if tone == "sharp"
                else "接下来把支出优先留给必要项目，预算仍有机会守住。"
            )
        )
        return advice_payload(headline, detail, ["减少高频小单", f"检查{top_category}明细", "保留刚需额度"])
    headline = "预算节奏还算稳定"
    detail = (
        f"本月支出 {expense:.0f} 元，预算使用 {usage:.0%}，剩余约 {remaining:.0f} 元。"
        f"最高分类是{top_category}，主要账户是{top_account}，日均支出约 {daily_average:.0f} 元。"
        + (
            "别被低价小单偷走预算，真正容易失控的往往不是大额消费，而是每天都觉得无所谓的小支出。"
            if tone == "sharp"
            else "整体节奏健康，继续保持记录，并每周看一次分类变化即可。"
        )
    )
    return advice_payload(headline, detail, ["继续保持记录", "每周复盘分类", "留意小额高频"])


def advice_payload(headline: str, detail: str, action_items: list[str]) -> dict:
    return {
        "advice": headline,
        "headline": headline,
        "detail": detail,
        "action_items": action_items,
    }


def cents(value: object) -> float:
    return int(value or 0) / 100


def first_name(items: object) -> str:
    if isinstance(items, list) and items:
        first = items[0]
        if isinstance(first, dict):
            return str(first.get("name") or "暂无")
    return "暂无"
