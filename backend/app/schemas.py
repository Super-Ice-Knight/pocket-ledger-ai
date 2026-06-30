from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator


TransactionType = Literal["expense", "income"]
AdviceTone = Literal["sharp", "warm"]


class TransactionBase(BaseModel):
    amount_cents: int = Field(ge=0)
    type: TransactionType = "expense"
    category: str = Field(min_length=1, max_length=24)
    account: str = Field(min_length=1, max_length=24)
    occurred_at: datetime
    note: str = Field(default="", max_length=120)
    raw_text: str | None = Field(default=None, max_length=240)

    @field_validator("category", "account", "note", mode="before")
    @classmethod
    def strip_text(cls, value: str | None) -> str:
        if value is None:
            return ""
        return str(value).strip()


class TransactionCreate(TransactionBase):
    pass


class TransactionUpdate(TransactionBase):
    pass


class Transaction(TransactionBase):
    id: int
    created_at: datetime


class ParseRequest(BaseModel):
    text: str = Field(min_length=1, max_length=240)


class ParseResult(TransactionBase):
    confidence: float = Field(ge=0, le=1)
    source: Literal["model", "local_rule", "error_fallback"]
    missing_fields: list[str] = []
    needs_review: bool = True


class BudgetCreate(BaseModel):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    limit_cents: int = Field(ge=0)
    category: str | None = Field(default=None, max_length=24)


class Budget(BudgetCreate):
    id: int
    spent_cents: int = 0
    remaining_cents: int = 0
    usage_ratio: float = 0


class MonthlyStats(BaseModel):
    month: str
    income_cents: int
    expense_cents: int
    balance_cents: int
    budget_limit_cents: int
    budget_remaining_cents: int
    budget_usage_ratio: float
    category_breakdown: list[dict]
    account_breakdown: list[dict]
    daily_trend: list[dict]
    recent_transactions: list[Transaction]


class AdviceResponse(BaseModel):
    tone: AdviceTone
    advice: str
    source: Literal["model", "local_rule", "error_fallback"]

