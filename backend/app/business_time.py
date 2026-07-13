from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo


BUSINESS_TIMEZONE = ZoneInfo("Asia/Shanghai")


def business_now() -> datetime:
    return datetime.now(BUSINESS_TIMEZONE).replace(microsecond=0)


def business_today() -> date:
    return business_now().date()


def to_business_datetime(value: datetime | str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return parsed.replace(tzinfo=BUSINESS_TIMEZONE)
    return parsed.astimezone(BUSINESS_TIMEZONE)


def business_date_key(value: datetime | str) -> str:
    return to_business_datetime(value).date().isoformat()
