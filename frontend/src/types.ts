export type TransactionType = "expense" | "income";
export type AdviceTone = "sharp" | "warm";

export interface Transaction {
  id: number;
  amount_cents: number;
  type: TransactionType;
  category: string;
  account: string;
  occurred_at: string;
  note: string;
  raw_text?: string | null;
  tags: string[];
  created_at: string;
}

export interface ParseResult extends Omit<Transaction, "id" | "created_at"> {
  confidence: number;
  source: "model" | "local_rule" | "error_fallback";
  provider: "primary" | "backup" | "local" | "fallback";
  missing_fields: string[];
  needs_review: boolean;
}

export interface MonthlyStats {
  month: string;
  income_cents: number;
  expense_cents: number;
  balance_cents: number;
  budget_limit_cents: number;
  budget_remaining_cents: number;
  budget_usage_ratio: number;
  category_breakdown: Array<{ name: string; amount_cents: number }>;
  account_breakdown: Array<{ name: string; amount_cents: number }>;
  daily_trend: Array<{ date: string; income_cents: number; expense_cents: number }>;
  recent_transactions: Transaction[];
}

export interface BudgetPayload {
  month: string;
  limit_cents: number;
  category?: string | null;
}

export interface AdviceResponse {
  tone: AdviceTone;
  advice: string;
  source: "model" | "local_rule" | "error_fallback";
  provider: "primary" | "backup" | "local" | "fallback";
}

export interface SettingsStatus {
  openai_base_url: string;
  openai_model: string;
  api_key_configured: boolean;
  primary_base_url: string;
  primary_model: string;
  primary_api_key_configured: boolean;
  backup_base_url: string;
  backup_model: string;
  backup_api_key_configured: boolean;
  backup_enabled: boolean;
  ai_request_timeout_seconds: number;
  database_file: string;
}

export interface AiSettingsPayload {
  primary_base_url: string;
  primary_model: string;
  primary_api_key?: string | null;
  backup_base_url: string;
  backup_model: string;
  backup_api_key?: string | null;
  ai_request_timeout_seconds: number;
}

export interface AiProviderTestResult {
  provider: "primary" | "backup";
  configured: boolean;
  ok: boolean;
  base_url: string;
  model: string;
  latency_ms: number;
  message: string;
}
