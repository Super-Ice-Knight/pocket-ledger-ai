from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta
from .repository import list_transactions, get_budget


def current_month() -> str:
    return datetime.now().strftime("%Y-%m")


def monthly_stats(conn: sqlite3.Connection, month: str | None = None) -> dict:
    target_month = month or current_month()
    transactions = list_transactions(conn, month=target_month)
    income = sum(item["amount_cents"] for item in transactions if item["type"] == "income")
    expense = sum(item["amount_cents"] for item in transactions if item["type"] == "expense")
    budget = get_budget(conn, target_month)
    budget_limit = budget["limit_cents"]
    remaining = budget_limit - expense if budget_limit else 0
    usage = expense / budget_limit if budget_limit else 0
    return {
        "month": target_month,
        "income_cents": income,
        "expense_cents": expense,
        "balance_cents": income - expense,
        "budget_limit_cents": budget_limit,
        "budget_remaining_cents": remaining,
        "budget_usage_ratio": round(usage, 4),
        "category_breakdown": aggregate(transactions, "category"),
        "account_breakdown": aggregate(transactions, "account"),
        "daily_trend": daily_trend(transactions),
        "recent_transactions": transactions[:8],
    }


def weekly_stats(conn: sqlite3.Connection, anchor: date | None = None) -> dict:
    target_date = anchor or date.today()
    week_start = target_date - timedelta(days=target_date.weekday())
    week_end = week_start + timedelta(days=6)
    transactions = list_transactions(
        conn,
        start_date=week_start.isoformat(),
        end_date=week_end.isoformat(),
    )
    income = sum(item["amount_cents"] for item in transactions if item["type"] == "income")
    expense = sum(item["amount_cents"] for item in transactions if item["type"] == "expense")
    return {
        "week_start": week_start,
        "week_end": week_end,
        "income_cents": income,
        "expense_cents": expense,
        "balance_cents": income - expense,
        "transaction_count": len(transactions),
    }


def aggregate(transactions: list[dict], key: str) -> list[dict]:
    buckets: dict[str, int] = {}
    for item in transactions:
        if item["type"] != "expense":
            continue
        buckets[item[key]] = buckets.get(item[key], 0) + item["amount_cents"]
    return [{"name": name, "amount_cents": amount} for name, amount in sorted(buckets.items(), key=lambda pair: pair[1], reverse=True)]


def daily_trend(transactions: list[dict]) -> list[dict]:
    buckets: dict[str, dict[str, int]] = {}
    for item in transactions:
        day = item["occurred_at"][:10]
        buckets.setdefault(day, {"date": day, "income_cents": 0, "expense_cents": 0})
        if item["type"] == "income":
            buckets[day]["income_cents"] += item["amount_cents"]
        else:
            buckets[day]["expense_cents"] += item["amount_cents"]
    return [buckets[day] for day in sorted(buckets)]
