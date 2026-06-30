from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re


class MoneyParseError(ValueError):
    pass


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


def cents_to_yuan(cents: int) -> str:
    yuan = Decimal(cents) / Decimal("100")
    return f"{yuan:.2f}"

