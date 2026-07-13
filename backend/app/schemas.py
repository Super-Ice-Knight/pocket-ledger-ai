from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, Field, field_validator


TransactionType = Literal["expense", "income"]
AdviceTone = Literal["sharp", "warm"]
AdviceSnapshotStatus = Literal["fresh", "stale", "missing"]
ProviderSlot = Literal["primary", "backup", "local", "fallback"]
AiProviderTestSlot = Literal["all", "primary", "backup"]


class TransactionBase(BaseModel):
    amount_cents: int = Field(ge=0)
    type: TransactionType = "expense"
    category: str = Field(min_length=1, max_length=24)
    account: str = Field(min_length=1, max_length=24)
    occurred_at: datetime
    note: str = Field(default="", max_length=120)
    raw_text: str | None = Field(default=None, max_length=240)
    tags: list[str] = Field(default_factory=list, max_length=8)

    @field_validator("category", "account", "note", mode="before")
    @classmethod
    def strip_text(cls, value: str | None) -> str:
        if value is None:
            return ""
        return str(value).strip()

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: list[str] | str | None) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            raw_tags = [part.strip() for part in value.replace("，", ",").split(",")]
        else:
            raw_tags = [str(part).strip() for part in value]
        tags: list[str] = []
        for tag in raw_tags:
            normalized = tag.lstrip("#").strip()
            if normalized and normalized not in tags:
                tags.append(normalized[:16])
        return tags[:8]


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
    provider: ProviderSlot = "local"
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


class WeeklyStats(BaseModel):
    week_start: date
    week_end: date
    income_cents: int
    expense_cents: int
    balance_cents: int
    transaction_count: int


class AdviceResponse(BaseModel):
    tone: AdviceTone
    advice: str
    headline: str
    detail: str
    action_items: list[str] = Field(default_factory=list, max_length=4)
    source: Literal["model", "local_rule", "error_fallback"]
    provider: ProviderSlot = "local"


class AdviceSnapshot(BaseModel):
    status: AdviceSnapshotStatus
    advice: AdviceResponse | None = None
    generated_at: datetime | None = None


class SettingsStatus(BaseModel):
    openai_base_url: str
    openai_model: str
    api_key_configured: bool
    primary_base_url: str
    primary_model: str
    primary_api_key_configured: bool
    backup_base_url: str
    backup_model: str
    backup_api_key_configured: bool
    backup_enabled: bool
    ai_request_timeout_seconds: int
    database_file: str
    runtime_settings_writable: bool


class AiSettingsUpdate(BaseModel):
    primary_base_url: str = Field(default="https://api.openai.com/v1", min_length=1, max_length=240)
    primary_model: str = Field(default="your-model-name", min_length=1, max_length=120)
    primary_api_key: str | None = Field(default=None, max_length=320)
    backup_base_url: str = Field(default="", max_length=240)
    backup_model: str = Field(default="", max_length=120)
    backup_api_key: str | None = Field(default=None, max_length=320)
    ai_request_timeout_seconds: int = Field(default=45, ge=5, le=120)

    @field_validator(
        "primary_base_url",
        "primary_model",
        "primary_api_key",
        "backup_base_url",
        "backup_model",
        "backup_api_key",
        mode="before",
    )
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return str(value).strip()


class AiProviderTestRequest(BaseModel):
    slot: AiProviderTestSlot = "all"


class AiProviderTestResult(BaseModel):
    provider: Literal["primary", "backup"]
    configured: bool
    ok: bool
    base_url: str
    model: str
    latency_ms: int
    message: str
