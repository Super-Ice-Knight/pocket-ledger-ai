from datetime import datetime, timedelta
from pathlib import Path
import httpx
from fastapi.testclient import TestClient

from app.database import init_db, connect
from app.config import get_settings
from app.main import app
from app.money import parse_yuan_to_cents
from app.repository import create_transaction
from app.schemas import TransactionCreate
from app.ai import build_chat_completion_payload, decode_json_object, local_parse
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

    response = client.get("/api/ai/monthly-advice?month=2026-07&tone=sharp")

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "local_rule"
    assert body["provider"] == "local"
    assert body["advice"] == body["headline"]
    assert body["detail"]
    assert len(body["action_items"]) >= 2


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

    response = client.get("/api/ai/monthly-advice?month=2026-07&tone=sharp")

    assert response.status_code == 200
    body = response.json()
    assert calls == ["primary-model"]
    assert body["source"] == "model"
    assert body["provider"] == "primary"
    assert body["headline"] == "咖啡预算正在偷跑"
    assert "小额高频" in body["detail"]
    assert body["action_items"] == ["减少饮品频率", "复盘餐饮明细"]
    assert "primary-secret" not in response.text
