from datetime import datetime, timedelta, timezone
from pathlib import Path
import httpx
from fastapi.testclient import TestClient

from app.database import init_db, connect, seed_demo_data
from app.config import get_settings
from app.main import app
from app.money import parse_yuan_to_cents
from app.repository import create_transaction
from app.schemas import TransactionCreate
from app.ai import build_chat_completion_payload, decode_json_object, detect_occurred_at, local_parse
from app.money import MAX_TRANSACTION_AMOUNT_CENTS
from app.runtime_settings import AiProvider


def test_local_parser_handles_selection_prompt_sentence():
    result = local_parse("今天中午和室友吃疯狂星期四花了 50 块，微信付的")
    assert result.amount_cents == 5000
    assert result.category == "餐饮"
    assert result.account == "微信"
    assert result.needs_review is True


def test_groq_qwen_request_disables_reasoning_for_low_latency():
    provider = AiProvider(
        slot="primary",
        base_url="https://api.groq.com/openai/v1",
        model="qwen/qwen3.6-27b",
        api_key="test-secret",
    )

    payload = build_chat_completion_payload(
        provider=provider,
        messages=[{"role": "user", "content": "返回 JSON"}],
        temperature=0.1,
        response_format={"type": "json_object"},
    )

    assert payload["reasoning_effort"] == "none"
    assert payload["response_format"] == {"type": "json_object"}


def test_json_decoder_accepts_reasoning_and_code_fence_wrapper():
    content = '<think>先分析预算。</think>\n```json\n{"headline":"预算稳定"}\n```'

    assert decode_json_object(content) == {"headline": "预算稳定"}


def test_local_parser_prefers_explicit_amount_over_dates_and_counts():
    result = local_parse("7月11日买了3杯咖啡，微信花了50元")

    assert result.amount_cents == 5000
    assert "amount_cents" not in result.missing_fields


def test_local_parser_marks_ambiguous_number_only_input_for_review():
    result = local_parse("7月11日买了3杯咖啡，微信")

    assert result.amount_cents == 0
    assert "amount_cents" in result.missing_fields


def test_local_parser_resolves_relative_dates():
    today = datetime.now().date()
    assert local_parse("今天咖啡 24 块微信").occurred_at.date() == today
    assert local_parse("昨天咖啡 24 块微信").occurred_at.date() == today - timedelta(days=1)
    assert local_parse("前天咖啡 24 块微信").occurred_at.date() == today - timedelta(days=2)


def test_transaction_can_be_created_and_retrieved(tmp_path: Path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    with connect(db_path) as conn:
        created = create_transaction(
            conn,
            TransactionCreate(
                amount_cents=parse_yuan_to_cents("19.9"),
                type="expense",
                category="餐饮",
                account="微信",
                occurred_at=datetime.now(),
                note="午餐",
                tags=["宿舍", "高频", "高频"],
            ),
        )
    assert created["amount_cents"] == 1990
    assert created["category"] == "餐饮"
    assert created["tags"] == ["宿舍", "高频"]


def test_weekly_ledger_includes_monday_to_sunday_only(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "weekly.db"))
    get_settings.cache_clear()
    init_db()
    client = TestClient(app)

    entries = [
        ("2026-07-05T09:00:00", "expense", 100, "上周日"),
        ("2026-07-06T09:00:00", "income", 10000, "周一收入"),
        ("2026-07-08T12:00:00", "expense", 2500, "周三午餐"),
        ("2026-07-12T18:00:00", "expense", 500, "周日饮品"),
        ("2026-07-13T09:00:00", "expense", 900, "下周一"),
    ]
    for occurred_at, tx_type, amount_cents, note in entries:
        response = client.post(
            "/api/transactions",
            json={
                "amount_cents": amount_cents,
                "type": tx_type,
                "category": "其他",
                "account": "现金",
                "occurred_at": occurred_at,
                "note": note,
                "raw_text": note,
                "tags": [],
            },
        )
        assert response.status_code == 200

    stats_response = client.get("/api/stats/weekly?date=2026-07-08")
    ledger_response = client.get("/api/transactions?start_date=2026-07-06&end_date=2026-07-12")
    invalid_range_response = client.get("/api/transactions?start_date=2026-07-12&end_date=2026-07-06")

    assert stats_response.status_code == 200
    assert stats_response.json() == {
        "week_start": "2026-07-06",
        "week_end": "2026-07-12",
        "income_cents": 10000,
        "expense_cents": 3000,
        "balance_cents": 7000,
        "transaction_count": 3,
    }
    assert ledger_response.status_code == 200
    assert [item["note"] for item in ledger_response.json()] == ["周日饮品", "周三午餐", "周一收入"]
    assert invalid_range_response.status_code == 422


def test_health_endpoint():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_public_settings_do_not_expose_api_key():
    client = TestClient(app)
    response = client.get("/api/settings/public")
    assert response.status_code == 200
    body = response.json()
    assert "api_key" not in body
    assert "api_key_configured" in body


def test_runtime_ai_settings_can_be_locked_for_public_demo(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "readonly_settings.db"))
    monkeypatch.setenv("RUNTIME_AI_SETTINGS_WRITABLE", "false")
    get_settings.cache_clear()
    init_db()
    client = TestClient(app)

    status_response = client.get("/api/settings/public")
    update_response = client.put(
        "/api/settings/ai",
        json={
            "primary_base_url": "https://primary.example/v1",
            "primary_model": "primary-model",
            "primary_api_key": "must-not-be-saved",
            "backup_base_url": "",
            "backup_model": "",
            "backup_api_key": "",
            "ai_request_timeout_seconds": 30,
        },
    )

    assert status_response.status_code == 200
    assert status_response.json()["runtime_settings_writable"] is False
    assert update_response.status_code == 403
    assert update_response.json()["detail"] == "线上演示环境不允许修改 AI 配置"
    assert "must-not-be-saved" not in update_response.text


def test_ai_settings_can_be_saved_without_exposing_keys(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "settings.db"))
    get_settings.cache_clear()
    init_db()
    client = TestClient(app)

    response = client.put(
        "/api/settings/ai",
        json={
            "primary_base_url": "https://apihub.agnes-ai.com/v1",
            "primary_model": "agnes-2.0-flash",
            "primary_api_key": "primary-secret",
            "backup_base_url": "https://api.siliconflow.cn/v1",
            "backup_model": "deepseek-ai/DeepSeek-V4-Pro",
            "backup_api_key": "backup-secret",
            "ai_request_timeout_seconds": 60,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["primary_model"] == "agnes-2.0-flash"
    assert body["backup_model"] == "deepseek-ai/DeepSeek-V4-Pro"
    assert body["primary_api_key_configured"] is True
    assert body["backup_api_key_configured"] is True
    assert "primary-secret" not in response.text
    assert "backup-secret" not in response.text

    public_response = client.get("/api/settings/public")
    assert public_response.json()["primary_base_url"] == "https://apihub.agnes-ai.com/v1"


def test_ai_parse_tries_backup_provider_after_primary_failure(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "backup.db"))
    get_settings.cache_clear()
    init_db()
    calls: list[str] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"amount_cents":3600,"type":"expense","category":"books",'
                                '"account":"alipay","occurred_at":"2026-07-07T12:00:00",'
                                '"note":"买书","tags":["小额高频"],"confidence":0.93,"missing_fields":[]}'
                            )
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url: str, headers: dict, json: dict):
            calls.append(json["model"])
            if json["model"] == "primary-model":
                raise httpx.TimeoutException("primary timed out")
            return FakeResponse()

    monkeypatch.setattr("app.ai.httpx.AsyncClient", FakeClient)
    client = TestClient(app)
    client.put(
        "/api/settings/ai",
        json={
            "primary_base_url": "https://primary.example/v1",
            "primary_model": "primary-model",
            "primary_api_key": "primary-secret",
            "backup_base_url": "https://backup.example/v1",
            "backup_model": "backup-model",
            "backup_api_key": "backup-secret",
            "ai_request_timeout_seconds": 30,
        },
    )

    response = client.post("/api/ai/parse-transaction", json={"text": "今天买书36块支付宝"})

    assert response.status_code == 200
    body = response.json()
    assert calls == ["primary-model", "backup-model"]
    assert body["source"] == "model"
    assert body["provider"] == "backup"
    assert body["category"] == "学习"
    assert body["account"] == "支付宝"
    assert body["tags"] == ["小额高频"]


def test_ai_parse_rejects_unknown_model_category_and_account(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "normalized_model.db"))
    get_settings.cache_clear()
    init_db()

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"amount_cents":3600,"type":"expense","category":"mystery",'
                                '"account":"unknown-pay","occurred_at":"2026-07-07T12:00:00",'
                                '"note":"买书","tags":[],"confidence":0.91,"missing_fields":[]}'
                            )
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url: str, headers: dict, json: dict):
            return FakeResponse()

    monkeypatch.setattr("app.ai.httpx.AsyncClient", FakeClient)
    client = TestClient(app)
    client.put(
        "/api/settings/ai",
        json={
            "primary_base_url": "https://primary.example/v1",
            "primary_model": "primary-model",
            "primary_api_key": "primary-secret",
            "backup_base_url": "",
            "backup_model": "",
            "backup_api_key": "",
            "ai_request_timeout_seconds": 30,
        },
    )

    response = client.post("/api/ai/parse-transaction", json={"text": "今天买书36块支付宝"})

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "model"
    assert body["category"] == "学习"
    assert body["account"] == "支付宝"


def test_ai_parse_falls_back_locally_when_all_providers_fail(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "all_providers_fail.db"))
    get_settings.cache_clear()
    init_db()
    calls: list[str] = []

    class FailingClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url: str, headers: dict, json: dict):
            calls.append(json["model"])
            raise httpx.TimeoutException("provider timed out")

    monkeypatch.setattr("app.ai.httpx.AsyncClient", FailingClient)
    client = TestClient(app)
    client.put(
        "/api/settings/ai",
        json={
            "primary_base_url": "https://primary.example/v1",
            "primary_model": "primary-model",
            "primary_api_key": "primary-secret",
            "backup_base_url": "https://backup.example/v1",
            "backup_model": "backup-model",
            "backup_api_key": "backup-secret",
            "ai_request_timeout_seconds": 30,
        },
    )

    response = client.post(
        "/api/ai/parse-transaction",
        json={"text": "昨天坐地铁花了12.6元，支付宝"},
    )

    assert response.status_code == 200
    body = response.json()
    assert calls == ["primary-model", "backup-model"]
    assert body["source"] == "error_fallback"
    assert body["provider"] == "fallback"
    assert body["amount_cents"] == 1260


def test_ai_failure_logs_are_structured_without_secrets_or_raw_text(tmp_path: Path, monkeypatch, caplog):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "safe_logs.db"))
    get_settings.cache_clear()
    init_db()

    class FailingClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url: str, headers: dict, json: dict):
            raise httpx.TimeoutException("provider timed out")

    monkeypatch.setattr("app.ai.httpx.AsyncClient", FailingClient)
    client = TestClient(app)
    client.put(
        "/api/settings/ai",
        json={
            "primary_base_url": "https://primary.example/v1",
            "primary_model": "primary-model",
            "primary_api_key": "private-api-key",
            "backup_base_url": "",
            "backup_model": "",
            "backup_api_key": "",
            "ai_request_timeout_seconds": 30,
        },
    )

    with caplog.at_level("INFO", logger="pocket_ledger.ai"):
        response = client.post("/api/ai/parse-transaction", json={"text": "私人账单原文花了18元"})

    assert response.status_code == 200
    assert "operation=parse" in caplog.text
    assert "slot=primary" in caplog.text
    assert "TimeoutException" in caplog.text
    assert "private-api-key" not in caplog.text
    assert "私人账单原文" not in caplog.text


def test_ai_provider_test_reports_status_without_exposing_keys(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "provider_test.db"))
    get_settings.cache_clear()
    init_db()
    calls: list[str] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": '{"ok":true}'}}]}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url: str, headers: dict, json: dict):
            calls.append(json["model"])
            if json["model"] == "backup-model":
                request = httpx.Request("POST", url)
                response = httpx.Response(400, request=request, text='{"message":"bad model"}')
                raise httpx.HTTPStatusError("bad model", request=request, response=response)
            return FakeResponse()

    monkeypatch.setattr("app.ai.httpx.AsyncClient", FakeClient)
    client = TestClient(app)
    client.put(
        "/api/settings/ai",
        json={
            "primary_base_url": "https://primary.example/v1",
            "primary_model": "primary-model",
            "primary_api_key": "primary-secret",
            "backup_base_url": "https://backup.example/v1",
            "backup_model": "backup-model",
            "backup_api_key": "backup-secret",
            "ai_request_timeout_seconds": 30,
        },
    )

    response = client.post("/api/settings/ai/test", json={"slot": "all"})

    assert response.status_code == 200
    body = response.json()
    assert calls == ["primary-model", "backup-model"]
    assert [item["provider"] for item in body] == ["primary", "backup"]
    assert body[0]["ok"] is True
    assert body[1]["ok"] is False
    assert body[1]["configured"] is True
    assert "primary-secret" not in response.text
    assert "backup-secret" not in response.text


def test_monthly_advice_returns_structured_local_payload(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "advice_local.db"))
    monkeypatch.delenv("OPENAI_COMPATIBLE_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_COMPATIBLE_MODEL", "your-model-name")
    get_settings.cache_clear()
    init_db()
    client = TestClient(app)

    cached_before_generation = client.get("/api/ai/monthly-advice?month=2026-07&tone=sharp")
    response = client.post("/api/ai/monthly-advice?month=2026-07&tone=sharp")
    cached_after_generation = client.get("/api/ai/monthly-advice?month=2026-07&tone=sharp")

    assert cached_before_generation.status_code == 200
    assert cached_before_generation.json() == {
        "status": "missing",
        "advice": None,
        "generated_at": None,
    }
    assert response.status_code == 200
    body = response.json()["advice"]
    assert body["source"] == "local_rule"
    assert body["provider"] == "local"
    assert body["advice"] == body["headline"]
    assert body["detail"]
    assert len(body["action_items"]) >= 2
    assert response.json()["status"] == "fresh"
    assert response.json()["generated_at"]
    assert cached_after_generation.json()["status"] == "fresh"
    assert cached_after_generation.json()["advice"] == body


def test_monthly_advice_uses_model_structured_json(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "advice_model.db"))
    get_settings.cache_clear()
    init_db()
    calls: list[str] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '<think>先比较预算、分类和日均支出。</think>\n```json\n'
                                '{"headline":"咖啡预算正在偷跑",'
                                '"detail":"本月餐饮和饮品支出偏高，预算还没有爆掉，但小额高频已经开始侵蚀剩余额度。接下来需要盯住每天的随手消费。",'
                                '"action_items":["减少饮品频率","复盘餐饮明细"]}\n```'
                            )
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url: str, headers: dict, json: dict):
            calls.append(json["model"])
            return FakeResponse()

    monkeypatch.setattr("app.ai.httpx.AsyncClient", FakeClient)
    client = TestClient(app)
    client.put(
        "/api/settings/ai",
        json={
            "primary_base_url": "https://primary.example/v1",
            "primary_model": "primary-model",
            "primary_api_key": "primary-secret",
            "backup_base_url": "",
            "backup_model": "",
            "backup_api_key": "",
            "ai_request_timeout_seconds": 30,
        },
    )

    cached_before_generation = client.get("/api/ai/monthly-advice?month=2026-07&tone=sharp")
    response = client.post("/api/ai/monthly-advice?month=2026-07&tone=sharp")
    cached_after_generation = client.get("/api/ai/monthly-advice?month=2026-07&tone=sharp")

    assert response.status_code == 200
    body = response.json()["advice"]
    assert cached_before_generation.json()["status"] == "missing"
    assert calls == ["primary-model"]
    assert body["source"] == "model"
    assert body["provider"] == "primary"
    assert body["headline"] == "咖啡预算正在偷跑"
    assert "小额高频" in body["detail"]
    assert body["action_items"] == ["减少饮品频率", "复盘餐饮明细"]
    assert "primary-secret" not in response.text
    assert cached_after_generation.json()["status"] == "fresh"
    assert cached_after_generation.json()["advice"] == body
    assert calls == ["primary-model"]

    transaction_response = client.post(
        "/api/transactions",
        json={
            "amount_cents": 5000,
            "type": "expense",
            "category": "餐饮",
            "account": "微信",
            "occurred_at": "2026-07-12T12:00:00",
            "note": "新增支出",
            "raw_text": "午餐花50元",
            "tags": [],
        },
    )
    stale_after_change = client.get("/api/ai/monthly-advice?month=2026-07&tone=sharp")

    assert transaction_response.status_code == 200
    assert stale_after_change.status_code == 200
    assert stale_after_change.json()["status"] == "stale"
    assert stale_after_change.json()["advice"] == body
    assert calls == ["primary-model"]


def test_transaction_amount_bounds_are_enforced_on_create_and_update(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "amount_bounds.db"))
    get_settings.cache_clear()
    init_db()
    client = TestClient(app)
    payload = {
        "amount_cents": 1,
        "type": "expense",
        "category": "餐饮",
        "account": "微信",
        "occurred_at": "2026-07-12T12:00:00+08:00",
        "note": "最小金额",
        "raw_text": "测试",
        "tags": [],
    }

    for invalid_amount in (0, -1, MAX_TRANSACTION_AMOUNT_CENTS + 1):
        response = client.post("/api/transactions", json={**payload, "amount_cents": invalid_amount})
        assert response.status_code == 422

    created = client.post("/api/transactions", json=payload)
    assert created.status_code == 200
    assert created.json()["amount_cents"] == 1

    updated = client.put(
        f"/api/transactions/{created.json()['id']}",
        json={**payload, "amount_cents": 0},
    )
    assert updated.status_code == 422


def test_business_timezone_and_time_edits_update_month_and_week_stats(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "business_time.db"))
    get_settings.cache_clear()
    init_db()
    client = TestClient(app)
    payload = {
        "amount_cents": 1260,
        "type": "expense",
        "category": "交通",
        "account": "支付宝",
        "occurred_at": "2026-06-30T16:30:00Z",
        "note": "跨日测试",
        "raw_text": "测试",
        "tags": [],
    }

    created = client.post("/api/transactions", json=payload)
    assert created.status_code == 200
    body = created.json()
    assert body["occurred_at"] == "2026-07-01T00:30:00+08:00"
    assert client.get("/api/stats/monthly?month=2026-06").json()["expense_cents"] == 0
    assert client.get("/api/stats/monthly?month=2026-07").json()["expense_cents"] == 1260
    assert client.get("/api/stats/weekly?date=2026-07-01").json()["expense_cents"] == 1260

    moved_to_next_week = client.put(
        f"/api/transactions/{body['id']}",
        json={**payload, "occurred_at": "2026-07-06T09:00:00+08:00"},
    )
    assert moved_to_next_week.status_code == 200
    assert client.get("/api/stats/weekly?date=2026-07-01").json()["expense_cents"] == 0
    assert client.get("/api/stats/weekly?date=2026-07-06").json()["expense_cents"] == 1260

    moved_to_next_month = client.put(
        f"/api/transactions/{body['id']}",
        json={**payload, "occurred_at": "2026-08-01T09:00:00+08:00"},
    )
    assert moved_to_next_month.status_code == 200
    assert client.get("/api/stats/monthly?month=2026-07").json()["expense_cents"] == 0
    assert client.get("/api/stats/monthly?month=2026-08").json()["expense_cents"] == 1260


def test_relative_dates_use_asia_shanghai_after_utc_day_rollover():
    utc_afternoon = datetime(2026, 7, 13, 16, 30, tzinfo=timezone.utc)

    assert detect_occurred_at("今天咖啡24元", utc_afternoon).date().isoformat() == "2026-07-14"
    assert detect_occurred_at("昨天咖啡24元", utc_afternoon).date().isoformat() == "2026-07-13"
    assert detect_occurred_at("前天咖啡24元", utc_afternoon).date().isoformat() == "2026-07-12"


def test_demo_data_is_seeded_once_and_does_not_return_after_user_deletes_it(tmp_path: Path):
    db_path = tmp_path / "demo_once.db"
    init_db(db_path)
    seed_demo_data(db_path)
    with connect(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 8
        conn.execute("DELETE FROM transactions")
        conn.commit()

    seed_demo_data(db_path)
    with connect(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0


def test_invalid_months_and_oversized_date_ranges_return_422(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "query_validation.db"))
    get_settings.cache_clear()
    init_db()
    client = TestClient(app)

    assert client.get("/api/stats/monthly?month=2026-99").status_code == 422
    assert client.get("/api/transactions?month=abcd").status_code == 422
    assert client.get("/api/ai/monthly-advice?month=2026-00").status_code == 422
    assert client.get("/api/transactions?start_date=2025-01-01&end_date=2026-12-31").status_code == 422


def test_model_missing_fields_are_recomputed_after_normalization(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("POCKET_LEDGER_DB_PATH", str(tmp_path / "recomputed_missing.db"))
    get_settings.cache_clear()
    init_db()

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "choices": [{"message": {"content": (
                    '{"amount_cents":0,"type":"expense","category":"mystery",'
                    '"account":"unknown-pay","note":"某事","tags":[],"confidence":0.7,"missing_fields":[]}'
                )}}]
            }

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url: str, headers: dict, json: dict):
            return FakeResponse()

    monkeypatch.setattr("app.ai.httpx.AsyncClient", FakeClient)
    client = TestClient(app)
    client.put(
        "/api/settings/ai",
        json={
            "primary_base_url": "https://primary.example/v1",
            "primary_model": "primary-model",
            "primary_api_key": "primary-secret",
            "backup_base_url": "",
            "backup_model": "",
            "backup_api_key": "",
            "ai_request_timeout_seconds": 30,
        },
    )

    response = client.post("/api/ai/parse-transaction", json={"text": "某事"})

    assert response.status_code == 200
    assert response.json()["source"] == "model"
    assert set(response.json()["missing_fields"]) == {
        "amount_cents",
        "category",
        "account",
        "occurred_at",
    }
