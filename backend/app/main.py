from __future__ import annotations

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from .ai import parse_with_model, monthly_advice
from .database import init_db, seed_demo_data, get_connection
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
    AdviceResponse,
    AdviceTone,
)
from .stats import monthly_stats, current_month


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    seed_demo_data()
    yield


app = FastAPI(title="Pocket Ledger AI", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


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
    type: str | None = Query(default=None),
    category: str | None = None,
    account: str | None = None,
) -> list[dict]:
    with get_connection() as conn:
        return list_transactions(conn, month=month, tx_type=type, category=category, account=account)


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


@app.get("/api/ai/monthly-advice", response_model=AdviceResponse)
async def monthly_advice_endpoint(month: str | None = None, tone: AdviceTone = "sharp") -> dict:
    with get_connection() as conn:
        stats = monthly_stats(conn, month or current_month())
    return await monthly_advice(stats, tone)


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
