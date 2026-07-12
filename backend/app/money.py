from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re


class MoneyParseError(ValueError):
    pass


AMOUNT_PATTERN = r"\d+(?:\.\d{1,4})?"


def parse_yuan_to_cents(value: str | int | float | Decimal) -> int:
    text = str(value).strip()
    match = re.search(r"-?\d+(?:\.\d{1,4})?", text)
    if not match:
        raise MoneyParseError("未找到有效金额")
    try:
        yuan = Decimal(match.group(0))
    except InvalidOperation as exc:
        raise MoneyParseError("金额格式非法") from exc
    cents = (yuan * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if cents < 0:
        raise MoneyParseError("金额不能为负数")
    return int(cents)


def extract_transaction_amount_cents(text: str) -> int:
    normalized = str(text).strip()
    explicit_patterns = [
        rf"[¥￥]\s*(?P<amount>{AMOUNT_PATTERN})",
        rf"(?P<amount>{AMOUNT_PATTERN})\s*(?:元|块|人民币|RMB)",
        (
            rf"(?:花了?|消费(?:了)?|支出|支付|用了?|收入|工资|报销|转入|到账|"
            rf"共计|合计|共|金额(?:是|为)?)\s*[¥￥]?\s*(?P<amount>{AMOUNT_PATTERN})"
        ),
    ]
    for pattern in explicit_patterns:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if match:
            return parse_yuan_to_cents(match.group("amount"))

    cleaned = re.sub(r"\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?", " ", normalized)
    cleaned = re.sub(r"\d{1,2}\s*月\s*\d{1,2}\s*[日号]", " ", cleaned)
    cleaned = re.sub(r"\d{1,2}\s*[:：]\s*\d{2}", " ", cleaned)
    cleaned = re.sub(r"\d{1,2}\s*(?:点|时)", " ", cleaned)
    cleaned = re.sub(
        rf"{AMOUNT_PATTERN}\s*(?:杯|个|份|张|次|本|件|盒|公里|小时|人)",
        " ",
        cleaned,
    )
    candidates = re.findall(AMOUNT_PATTERN, cleaned)
    if len(candidates) == 1:
        return parse_yuan_to_cents(candidates[0])
    raise MoneyParseError("未找到无歧义的金额")


def cents_to_yuan(cents: int) -> str:
    yuan = Decimal(cents) / Decimal("100")
    return f"{yuan:.2f}"
