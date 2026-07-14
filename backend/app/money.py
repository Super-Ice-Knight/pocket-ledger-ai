from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re


class MoneyParseError(ValueError):
    pass


MAX_TRANSACTION_AMOUNT_CENTS = 9_999_999_999
AMOUNT_PATTERN = r"\d+(?:\.\d{1,4})?"
QUANTITY_UNIT_PATTERN = r"(?:杯|个|份|张|次|本|件|盒|公里|小时|人)"
FOREIGN_CURRENCY_PATTERN = (
    r"(?:US\$|HK\$|\$|€|£|\b(?:USD|EUR|GBP|JPY|HKD|KRW)\b|"
    r"美元|美金|欧元|英镑|日元|港币|韩元)"
)


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
    if cents <= 0:
        raise MoneyParseError("金额必须大于 0 元")
    if cents > MAX_TRANSACTION_AMOUNT_CENTS:
        raise MoneyParseError("金额不能超过 99,999,999.99 元")
    return int(cents)


def extract_transaction_amount_cents(text: str) -> int:
    normalized = str(text).strip()
    if re.search(FOREIGN_CURRENCY_PATTERN, normalized, flags=re.IGNORECASE):
        raise MoneyParseError("暂不支持把外币金额直接记为人民币")
    if re.search(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", normalized):
        raise MoneyParseError("带千位分隔符的金额需要手动确认")
    explicit_patterns = [
        rf"[¥￥]\s*(?P<amount>{AMOUNT_PATTERN})",
        rf"(?P<amount>{AMOUNT_PATTERN})\s*(?:元|块|人民币|RMB)",
        (
            rf"(?:花了?|消费(?:了)?|支出|支付|用了?|收入|工资|报销|转入|到账|"
            rf"共计|合计|共|金额(?:是|为)?)\s*[¥￥]?\s*(?P<amount>{AMOUNT_PATTERN})"
        ),
    ]
    explicit_candidates: dict[tuple[int, int], str] = {}
    for pattern in explicit_patterns:
        for match in re.finditer(pattern, normalized, flags=re.IGNORECASE):
            amount_span = match.span("amount")
            if re.match(rf"\s*{QUANTITY_UNIT_PATTERN}", normalized[amount_span[1]:]):
                continue
            explicit_candidates[amount_span] = match.group("amount")
    if len(explicit_candidates) == 1:
        return parse_yuan_to_cents(next(iter(explicit_candidates.values())))
    if len(explicit_candidates) > 1:
        raise MoneyParseError("检测到多个金额，请拆分或手动确认")

    cleaned = re.sub(r"\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?", " ", normalized)
    cleaned = re.sub(r"\d{1,2}\s*月\s*\d{1,2}\s*[日号]", " ", cleaned)
    cleaned = re.sub(r"\d{1,2}\s*[:：]\s*\d{2}", " ", cleaned)
    cleaned = re.sub(r"\d{1,2}\s*(?:点|时)", " ", cleaned)
    cleaned = re.sub(
        rf"{AMOUNT_PATTERN}\s*{QUANTITY_UNIT_PATTERN}",
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
