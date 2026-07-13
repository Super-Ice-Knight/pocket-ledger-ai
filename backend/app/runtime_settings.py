from __future__ import annotations

from dataclasses import dataclass
import sqlite3

from .business_time import business_now
from .config import get_settings
from .database import connect
from .schemas import AiSettingsUpdate, SettingsStatus


SETTING_KEYS = {
    "primary_base_url",
    "primary_model",
    "primary_api_key",
    "backup_base_url",
    "backup_model",
    "backup_api_key",
    "ai_request_timeout_seconds",
}


@dataclass(frozen=True)
class AiProvider:
    slot: str
    base_url: str
    model: str
    api_key: str


@dataclass(frozen=True)
class RuntimeAiSettings:
    primary_base_url: str
    primary_model: str
    primary_api_key: str
    backup_base_url: str
    backup_model: str
    backup_api_key: str
    ai_request_timeout_seconds: int

    def configured_providers(self) -> list[AiProvider]:
        providers: list[AiProvider] = []
        if self.primary_api_key and self.primary_model != "your-model-name":
            providers.append(
                AiProvider(
                    slot="primary",
                    base_url=self.primary_base_url,
                    model=self.primary_model,
                    api_key=self.primary_api_key,
                )
            )
        if self.backup_api_key and self.backup_base_url and self.backup_model:
            providers.append(
                AiProvider(
                    slot="backup",
                    base_url=self.backup_base_url,
                    model=self.backup_model,
                    api_key=self.backup_api_key,
                )
            )
        return providers


def get_runtime_ai_settings(conn: sqlite3.Connection | None = None) -> RuntimeAiSettings:
    settings = get_settings()
    stored = _read_settings(conn)
    return RuntimeAiSettings(
        primary_base_url=stored.get("primary_base_url") or settings.openai_base_url,
        primary_model=stored.get("primary_model") or settings.openai_model,
        primary_api_key=stored.get("primary_api_key") or settings.openai_api_key or "",
        backup_base_url=stored.get("backup_base_url") or settings.backup_openai_base_url,
        backup_model=stored.get("backup_model") or settings.backup_openai_model,
        backup_api_key=stored.get("backup_api_key") or settings.backup_openai_api_key or "",
        ai_request_timeout_seconds=_parse_timeout(
            stored.get("ai_request_timeout_seconds"),
            settings.ai_request_timeout_seconds,
        ),
    )


def save_runtime_ai_settings(payload: AiSettingsUpdate) -> SettingsStatus:
    with connect() as conn:
        current = get_runtime_ai_settings(conn)
        values = {
            "primary_base_url": payload.primary_base_url,
            "primary_model": payload.primary_model,
            "primary_api_key": payload.primary_api_key or current.primary_api_key,
            "backup_base_url": payload.backup_base_url,
            "backup_model": payload.backup_model,
            "backup_api_key": payload.backup_api_key or current.backup_api_key,
            "ai_request_timeout_seconds": str(payload.ai_request_timeout_seconds),
        }
        _write_settings(conn, values)
        next_settings = get_runtime_ai_settings(conn)
    return to_settings_status(next_settings)


def get_settings_status() -> SettingsStatus:
    return to_settings_status(get_runtime_ai_settings())


def to_settings_status(runtime: RuntimeAiSettings) -> SettingsStatus:
    primary_configured = bool(runtime.primary_api_key)
    backup_configured = bool(runtime.backup_api_key and runtime.backup_base_url and runtime.backup_model)
    return SettingsStatus(
        openai_base_url=runtime.primary_base_url,
        openai_model=runtime.primary_model,
        api_key_configured=primary_configured,
        primary_base_url=runtime.primary_base_url,
        primary_model=runtime.primary_model,
        primary_api_key_configured=primary_configured,
        backup_base_url=runtime.backup_base_url,
        backup_model=runtime.backup_model,
        backup_api_key_configured=bool(runtime.backup_api_key),
        backup_enabled=backup_configured,
        ai_request_timeout_seconds=runtime.ai_request_timeout_seconds,
        database_file=get_settings().resolved_database_path.name,
        runtime_settings_writable=get_settings().runtime_ai_settings_writable,
    )


def _read_settings(conn: sqlite3.Connection | None = None) -> dict[str, str]:
    should_close = conn is None
    active_conn = conn or connect()
    try:
        rows = active_conn.execute("SELECT key, value FROM app_settings").fetchall()
        return {row["key"]: row["value"] for row in rows if row["key"] in SETTING_KEYS}
    except sqlite3.OperationalError:
        return {}
    finally:
        if should_close:
            active_conn.close()


def _write_settings(conn: sqlite3.Connection, values: dict[str, str]) -> None:
    now = business_now().isoformat()
    conn.executemany(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        [(key, str(value), now) for key, value in values.items() if key in SETTING_KEYS],
    )
    conn.commit()


def _parse_timeout(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return min(max(parsed, 5), 120)
