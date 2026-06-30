from __future__ import annotations

import sqlite3
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
        conn.commit()


@contextmanager
def get_connection():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def seed_demo_data(db_path: Path | None = None) -> None:
    with connect(db_path) as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM transactions").fetchone()["c"]
        if count:
            return
        now = datetime.now().replace(minute=0, second=0, microsecond=0)
        rows = [
            (1800, "expense", "餐饮", "微信", now - timedelta(days=1), "食堂午餐", "昨天食堂花了18微信付的"),
            (5000, "expense", "餐饮", "微信", now - timedelta(days=2), "疯狂星期四", "今天中午和室友吃疯狂星期四花了50块"),
            (1260, "expense", "交通", "支付宝", now - timedelta(days=3), "地铁", "地铁通勤12.6"),
            (8900, "expense", "学习", "支付宝", now - timedelta(days=4), "课程资料", "买资料89"),
            (3200, "expense", "娱乐", "微信", now - timedelta(days=5), "电影", "周末电影32"),
            (200000, "income", "兼职", "银行卡", now - timedelta(days=6), "家教收入", "家教收入2000"),
            (2400, "expense", "饮品", "微信", now - timedelta(days=7), "咖啡", "咖啡24"),
            (7600, "expense", "购物", "支付宝", now - timedelta(days=8), "生活用品", "生活用品76"),
        ]
        conn.executemany(
            """
            INSERT INTO transactions
                (amount_cents, type, category, account, occurred_at, note, raw_text, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (amount, tx_type, category, account, occurred.isoformat(), note, raw, now.isoformat())
                for amount, tx_type, category, account, occurred, note, raw in rows
            ],
        )
        month = now.strftime("%Y-%m")
        conn.execute(
            """
            INSERT OR IGNORE INTO budgets (month, category, limit_cents, created_at)
            VALUES (?, NULL, ?, ?)
            """,
            (month, 180000, now.isoformat()),
        )
        conn.commit()

