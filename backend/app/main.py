from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from .ai import parse_with_model, monthly_advice, test_ai_providers
from .advice_cache import advice_context_hash, read_advice_snapshot, write_advice_snapshot
from .database import init_db, seed_demo_data, get_connection
from .runtime_settings import get_runtime_ai_settings, get_settings_status, save_runtime_ai_settings
from .repository import (
    create_transaction,
    update_transaction,
    delete_transaction,
    list_transactions,
    upsert_budget,
)
from .schemas import (
    ParseRequest,
    ParseResult,
    Transaction,
    TransactionCreate,
    TransactionUpdate,
    Budget,
    BudgetCreate,
    MonthlyStats,
    WeeklyStats,
    AdviceResponse,
    AdviceSnapshot,
    AdviceTone,
    SettingsStatus,
    AiSettingsUpdate,
    AiProviderTestRequest,
    AiProviderTestResult,
)
from .stats import monthly_stats, weekly_stats, current_month
from .config import get_settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    seed_demo_data()
    yield


app = FastAPI(title="Pocket Ledger AI", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root() -> dict:
    return {
        "name": "Pocket Ledger AI API",
        "status": "running",
        "health": "/api/health",
        "docs": "/docs",
    }


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/settings/public", response_model=SettingsStatus)
def settings_public() -> SettingsStatus:
    return get_settings_status()


@app.put("/api/settings/ai", response_model=SettingsStatus)
def update_ai_settings(payload: AiSettingsUpdate) -> SettingsStatus:
    if not get_settings().runtime_ai_settings_writable:
        raise HTTPException(status_code=403, detail="线上演示环境不允许修改 AI 配置")
    return save_runtime_ai_settings(payload)


@app.post("/api/settings/ai/test", response_model=list[AiProviderTestResult])
async def test_ai_settings(payload: AiProviderTestRequest) -> list[AiProviderTestResult]:
    return await test_ai_providers(payload.slot)


@app.post("/api/ai/parse-transaction", response_model=ParseResult)
async def parse_transaction(request: ParseRequest) -> ParseResult:
    return await parse_with_model(request.text)


@app.post("/api/transactions", response_model=Transaction)
def create_transaction_endpoint(payload: TransactionCreate) -> dict:
    with get_connection() as conn:
        return create_transaction(conn, payload)


@app.get("/api/transactions", response_model=list[Transaction])
def list_transactions_endpoint(
    month: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    type: str | None = Query(default=None),
    category: str | None = None,
    account: str | None = None,
) -> list[dict]:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
    with get_connection() as conn:
        return list_transactions(
            conn,
            month=month,
            start_date=start_date.isoformat() if start_date else None,
            end_date=end_date.isoformat() if end_date else None,
            tx_type=type,
            category=category,
            account=account,
        )


@app.put("/api/transactions/{transaction_id}", response_model=Transaction)
def update_transaction_endpoint(transaction_id: int, payload: TransactionUpdate) -> dict:
    with get_connection() as conn:
        try:
            return update_transaction(conn, transaction_id, payload)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="账单不存在") from exc


@app.delete("/api/transactions/{transaction_id}")
def delete_transaction_endpoint(transaction_id: int) -> dict:
    with get_connection() as conn:
        try:
            delete_transaction(conn, transaction_id)
            return {"ok": True}
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="账单不存在") from exc


@app.get("/api/stats/monthly", response_model=MonthlyStats)
def monthly_stats_endpoint(month: str | None = None) -> dict:
    with get_connection() as conn:
        return monthly_stats(conn, month or current_month())


@app.get("/api/stats/weekly", response_model=WeeklyStats)
def weekly_stats_endpoint(anchor: date | None = Query(default=None, alias="date")) -> dict:
    with get_connection() as conn:
        return weekly_stats(conn, anchor)


@app.post("/api/budgets", response_model=Budget)
def set_budget_endpoint(payload: BudgetCreate) -> dict:
    with get_connection() as conn:
        budget = upsert_budget(conn, payload)
        stats = monthly_stats(conn, payload.month)
        spent = stats["expense_cents"]
        limit = budget["limit_cents"]
        return {
            **budget,
            "spent_cents": spent,
            "remaining_cents": limit - spent,
            "usage_ratio": round(spent / limit, 4) if limit else 0,
        }


@app.get("/api/ai/monthly-advice", response_model=AdviceSnapshot)
def monthly_advice_snapshot_endpoint(month: str | None = None, tone: AdviceTone = "sharp") -> dict:
    target_month = month or current_month()
    with get_connection() as conn:
        stats = monthly_stats(conn, target_month)
        runtime = get_runtime_ai_settings(conn)
        context_hash = advice_context_hash(stats, tone, runtime)
        return read_advice_snapshot(conn, target_month, tone, context_hash)


@app.post("/api/ai/monthly-advice", response_model=AdviceSnapshot)
async def generate_monthly_advice_endpoint(month: str | None = None, tone: AdviceTone = "sharp") -> dict:
    target_month = month or current_month()
    with get_connection() as conn:
        stats = monthly_stats(conn, target_month)
        runtime = get_runtime_ai_settings(conn)
        context_hash = advice_context_hash(stats, tone, runtime)

    advice = await monthly_advice(stats, tone)
    if advice["source"] == "error_fallback":
        return {"status": "fresh", "advice": advice, "generated_at": None}

    with get_connection() as conn:
        generated_at = write_advice_snapshot(conn, target_month, tone, context_hash, advice)
    return {"status": "fresh", "advice": advice, "generated_at": generated_at}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
