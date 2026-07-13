from __future__ import annotations

import sqlite3
import json
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from .config import get_settings


SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
    type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
    category TEXT NOT NULL,
    account TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    raw_text TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    category TEXT,
    limit_cents INTEGER NOT NULL CHECK(limit_cents >= 0),
    created_at TEXT NOT NULL,
    UNIQUE(month, category)
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_advice_cache (
    month TEXT NOT NULL,
    tone TEXT NOT NULL CHECK(tone IN ('sharp', 'warm')),
    context_hash TEXT NOT NULL,
    payload TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    PRIMARY KEY(month, tone)
);
"""


def database_path() -> Path:
    path = get_settings().resolved_database_path
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Path | None = None) -> None:
    with connect(db_path) as conn:
        conn.executescript(SCHEMA)
        ensure_columns(conn)
        conn.commit()


def ensure_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(transactions)").fetchall()}
    if "tags" not in columns:
        conn.execute("ALTER TABLE transactions ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")


@contextmanager
def get_connection():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def seed_demo_data(db_path: Path | None = None) -> None:
    with connect(db_path) as conn:
        now = datetime.now().replace(minute=0, second=0, microsecond=0)
        month = now.strftime("%Y-%m")
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM transactions WHERE substr(occurred_at, 1, 7) = ?",
            (month,),
        ).fetchone()["c"]
        if count:
            return
        max_offset = max(now.day - 1, 0)

        def in_current_month(days_back: int) -> datetime:
            return now - timedelta(days=min(days_back, max_offset))

        rows = [
            (1800, "expense", "餐饮", "微信", in_current_month(0), "食堂午餐", "昨天食堂花了18微信付的", ["刚需"]),
            (5000, "expense", "餐饮", "微信", in_current_month(1), "疯狂星期四", "今天中午和室友吃疯狂星期四花了50块", ["社交", "高频"]),
            (1260, "expense", "交通", "支付宝", in_current_month(2), "地铁", "地铁通勤12.6", ["通勤"]),
            (8900, "expense", "学习", "支付宝", in_current_month(3), "课程资料", "买资料89", ["学习投资"]),
            (3200, "expense", "娱乐", "微信", in_current_month(4), "电影", "周末电影32", ["周末"]),
            (200000, "income", "兼职", "银行卡", in_current_month(5), "家教收入", "家教收入2000", ["收入"]),
            (2400, "expense", "饮品", "微信", in_current_month(6), "咖啡", "咖啡24", ["小额高频"]),
            (7600, "expense", "购物", "支付宝", in_current_month(7), "生活用品", "生活用品76", ["宿舍"]),
        ]
        conn.executemany(
            """
            INSERT INTO transactions
                (amount_cents, type, category, account, occurred_at, note, raw_text, tags, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (amount, tx_type, category, account, occurred.isoformat(), note, raw, json.dumps(tags, ensure_ascii=False), now.isoformat())
                for amount, tx_type, category, account, occurred, note, raw, tags in rows
            ],
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO budgets (month, category, limit_cents, created_at)
            VALUES (?, NULL, ?, ?)
            """,
            (month, 180000, now.isoformat()),
        )
        conn.commit()
