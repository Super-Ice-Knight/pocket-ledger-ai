from __future__ import annotations

import sqlite3
import json
from .business_time import business_date_key, business_now, to_business_datetime
from .schemas import TransactionCreate, TransactionUpdate, BudgetCreate


def encode_tags(tags: list[str]) -> str:
    return json.dumps(tags, ensure_ascii=False)


def decode_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [str(item) for item in data if str(item).strip()]


def row_to_transaction(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "amount_cents": row["amount_cents"],
        "type": row["type"],
        "category": row["category"],
        "account": row["account"],
        "occurred_at": to_business_datetime(row["occurred_at"]).isoformat(),
        "note": row["note"],
        "raw_text": row["raw_text"],
        "tags": decode_tags(row["tags"]),
        "created_at": to_business_datetime(row["created_at"]).isoformat(),
    }


def create_transaction(conn: sqlite3.Connection, payload: TransactionCreate) -> dict:
    now = business_now().isoformat()
    cursor = conn.execute(
        """
        INSERT INTO transactions
            (amount_cents, type, category, account, occurred_at, note, raw_text, tags, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.amount_cents,
            payload.type,
            payload.category,
            payload.account,
            payload.occurred_at.isoformat(),
            payload.note,
            payload.raw_text,
            encode_tags(payload.tags),
            now,
        ),
    )
    conn.commit()
    return get_transaction(conn, cursor.lastrowid)


def get_transaction(conn: sqlite3.Connection, transaction_id: int) -> dict:
    row = conn.execute("SELECT * FROM transactions WHERE id = ?", (transaction_id,)).fetchone()
    if row is None:
        raise KeyError(transaction_id)
    return row_to_transaction(row)


def update_transaction(conn: sqlite3.Connection, transaction_id: int, payload: TransactionUpdate) -> dict:
    conn.execute(
        """
        UPDATE transactions
        SET amount_cents = ?, type = ?, category = ?, account = ?, occurred_at = ?, note = ?, raw_text = ?, tags = ?
        WHERE id = ?
        """,
        (
            payload.amount_cents,
            payload.type,
            payload.category,
            payload.account,
            payload.occurred_at.isoformat(),
            payload.note,
            payload.raw_text,
            encode_tags(payload.tags),
            transaction_id,
        ),
    )
    conn.commit()
    return get_transaction(conn, transaction_id)


def delete_transaction(conn: sqlite3.Connection, transaction_id: int) -> None:
    cursor = conn.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))
    conn.commit()
    if cursor.rowcount == 0:
        raise KeyError(transaction_id)


def list_transactions(
    conn: sqlite3.Connection,
    month: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    tx_type: str | None = None,
    category: str | None = None,
    account: str | None = None,
) -> list[dict]:
    clauses = []
    params: list[str] = []
    if tx_type:
        clauses.append("type = ?")
        params.append(tx_type)
    if category:
        clauses.append("category = ?")
        params.append(category)
    if account:
        clauses.append("account = ?")
        params.append(account)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = conn.execute(f"SELECT * FROM transactions {where}", params).fetchall()
    transactions = [row_to_transaction(row) for row in rows]
    if month:
        transactions = [item for item in transactions if business_date_key(item["occurred_at"])[:7] == month]
    if start_date:
        transactions = [item for item in transactions if business_date_key(item["occurred_at"]) >= start_date]
    if end_date:
        transactions = [item for item in transactions if business_date_key(item["occurred_at"]) <= end_date]
    return sorted(
        transactions,
        key=lambda item: to_business_datetime(item["occurred_at"]),
        reverse=True,
    )


def upsert_budget(conn: sqlite3.Connection, payload: BudgetCreate) -> dict:
    now = business_now().isoformat()
    if payload.category is None:
        cursor = conn.execute(
            "UPDATE budgets SET limit_cents = ? WHERE month = ? AND category IS NULL",
            (payload.limit_cents, payload.month),
        )
        if cursor.rowcount == 0:
            conn.execute(
                "INSERT INTO budgets (month, category, limit_cents, created_at) VALUES (?, NULL, ?, ?)",
                (payload.month, payload.limit_cents, now),
            )
    else:
        cursor = conn.execute(
            "UPDATE budgets SET limit_cents = ? WHERE month = ? AND category = ?",
            (payload.limit_cents, payload.month, payload.category),
        )
        if cursor.rowcount == 0:
            conn.execute(
                "INSERT INTO budgets (month, category, limit_cents, created_at) VALUES (?, ?, ?, ?)",
                (payload.month, payload.category, payload.limit_cents, now),
            )
    conn.commit()
    return get_budget(conn, payload.month, payload.category)


def get_budget(conn: sqlite3.Connection, month: str, category: str | None = None) -> dict:
    if category is None:
        row = conn.execute("SELECT * FROM budgets WHERE month = ? AND category IS NULL", (month,)).fetchone()
    else:
        row = conn.execute("SELECT * FROM budgets WHERE month = ? AND category = ?", (month, category)).fetchone()
    if row is None:
        return {"id": 0, "month": month, "category": category, "limit_cents": 0}
    return dict(row)
