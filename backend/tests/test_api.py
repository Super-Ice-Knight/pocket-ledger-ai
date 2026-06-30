from datetime import datetime
from pathlib import Path
from fastapi.testclient import TestClient

from app.database import init_db, connect
from app.main import app
from app.money import parse_yuan_to_cents
from app.repository import create_transaction
from app.schemas import TransactionCreate
from app.ai import local_parse


def test_local_parser_handles_selection_prompt_sentence():
    result = local_parse("今天中午和室友吃疯狂星期四花了 50 块，微信付的")
    assert result.amount_cents == 5000
    assert result.category == "餐饮"
    assert result.account == "微信"
    assert result.needs_review is True


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
            ),
        )
    assert created["amount_cents"] == 1990
    assert created["category"] == "餐饮"


def test_health_endpoint():
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}

