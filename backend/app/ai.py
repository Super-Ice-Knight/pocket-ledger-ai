from __future__ import annotations

from datetime import datetime
import json
import re
import httpx
from .config import get_settings
from .money import parse_yuan_to_cents, MoneyParseError
from .schemas import ParseResult, AdviceTone


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


def local_parse(text: str) -> ParseResult:
    missing: list[str] = []
    now = datetime.now().replace(microsecond=0)
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
        occurred_at=now,
        note=note,
        raw_text=text,
        confidence=0.86 if not missing else 0.52,
        source="local_rule",
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


def build_note(text: str, category: str, account: str) -> str:
    cleaned = text
    cleaned = re.sub(r"\d+(?:\.\d+)?\s*(元|块|rmb|RMB)?", "", cleaned)
    for word in [category, account, "今天", "昨天", "中午", "晚上", "早上", "付的", "花了", "消费", "支出", "收入"]:
        cleaned = cleaned.replace(word, "")
    cleaned = re.sub(r"[，。,.\s]+", " ", cleaned).strip()
    return cleaned[:40] or category


async def parse_with_model(text: str) -> ParseResult:
    settings = get_settings()
    if not settings.openai_api_key or settings.openai_model == "your-model-name":
        return local_parse(text)
    prompt = (
        "你是记账系统的结构化解析器。只返回 JSON, 不要解释。"
        "字段: amount_cents(int), type(expense|income), category, account, occurred_at(ISO), note, "
        "confidence(0-1), missing_fields(array)。金额必须转换为分。"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{settings.openai_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={
                    "model": settings.openai_model,
                    "messages": [
                        {"role": "system", "content": prompt},
                        {"role": "user", "content": text},
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": 0.1,
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            local = local_parse(text)
            return ParseResult(
                amount_cents=int(parsed.get("amount_cents") or local.amount_cents),
                type=parsed.get("type") or local.type,
                category=parsed.get("category") or local.category,
                account=parsed.get("account") or local.account,
                occurred_at=parsed.get("occurred_at") or local.occurred_at,
                note=parsed.get("note") or local.note,
                raw_text=text,
                confidence=float(parsed.get("confidence") or 0.78),
                source="model",
                missing_fields=parsed.get("missing_fields") or [],
                needs_review=True,
            )
    except Exception:
        fallback = local_parse(text)
        fallback.source = "error_fallback"
        return fallback


async def monthly_advice(stats: dict, tone: AdviceTone) -> dict:
    settings = get_settings()
    fallback = local_advice(stats, tone)
    if not settings.openai_api_key or settings.openai_model == "your-model-name":
        return {"tone": tone, "advice": fallback, "source": "local_rule"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{settings.openai_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={
                    "model": settings.openai_model,
                    "messages": [
                        {"role": "system", "content": "你是个人财务建议助手。输出一句 40 字以内的中文建议。不要编造数字。"},
                        {"role": "user", "content": json.dumps({"stats": stats, "tone": tone}, ensure_ascii=False)},
                    ],
                    "temperature": 0.5,
                },
            )
            response.raise_for_status()
            advice = response.json()["choices"][0]["message"]["content"].strip()
            return {"tone": tone, "advice": advice[:80], "source": "model"}
    except Exception:
        return {"tone": tone, "advice": fallback, "source": "error_fallback"}


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

