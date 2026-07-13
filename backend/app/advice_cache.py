from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone

from .runtime_settings import RuntimeAiSettings
from .schemas import AdviceTone


ADVICE_PROMPT_VERSION = "2026-07-13-v1"


def advice_context_hash(stats: dict, tone: AdviceTone, runtime: RuntimeAiSettings) -> str:
    providers = [
        {
            "slot": provider.slot,
            "base_url": provider.base_url,
            "model": provider.model,
        }
        for provider in runtime.configured_providers()
    ]
    context = {
        "prompt_version": ADVICE_PROMPT_VERSION,
        "tone": tone,
        "stats": stats,
        "providers": providers,
    }
    serialized = json.dumps(context, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def read_advice_snapshot(
    conn: sqlite3.Connection,
    month: str,
    tone: AdviceTone,
    context_hash: str,
) -> dict:
    row = conn.execute(
        "SELECT context_hash, payload, generated_at FROM ai_advice_cache WHERE month = ? AND tone = ?",
        (month, tone),
    ).fetchone()
    if row is None:
        return {"status": "missing", "advice": None, "generated_at": None}

    try:
        advice = json.loads(row["payload"])
    except (TypeError, json.JSONDecodeError):
        return {"status": "missing", "advice": None, "generated_at": None}

    return {
        "status": "fresh" if row["context_hash"] == context_hash else "stale",
        "advice": advice,
        "generated_at": row["generated_at"],
    }


def write_advice_snapshot(
    conn: sqlite3.Connection,
    month: str,
    tone: AdviceTone,
    context_hash: str,
    advice: dict,
) -> str:
    generated_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO ai_advice_cache (month, tone, context_hash, payload, generated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(month, tone) DO UPDATE SET
            context_hash = excluded.context_hash,
            payload = excluded.payload,
            generated_at = excluded.generated_at
        """,
        (
            month,
            tone,
            context_hash,
            json.dumps(advice, ensure_ascii=False, separators=(",", ":")),
            generated_at,
        ),
    )
    conn.commit()
    return generated_at
