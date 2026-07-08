import type { AdviceResponse, AdviceTone, AiProviderTestResult, AiSettingsPayload, BudgetPayload, MonthlyStats, ParseResult, SettingsStatus, Transaction } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  parseTransaction(text: string) {
    return request<ParseResult>("/api/ai/parse-transaction", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },
  createTransaction(payload: Omit<Transaction, "id" | "created_at">) {
    return request<Transaction>("/api/transactions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateTransaction(id: number, payload: Omit<Transaction, "id" | "created_at">) {
    return request<Transaction>(`/api/transactions/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  deleteTransaction(id: number) {
    return request<{ ok: boolean }>(`/api/transactions/${id}`, { method: "DELETE" });
  },
  listTransactions(month: string) {
    return request<Transaction[]>(`/api/transactions?month=${month}`);
  },
  monthlyStats(month: string) {
    return request<MonthlyStats>(`/api/stats/monthly?month=${month}`);
  },
  setBudget(payload: BudgetPayload) {
    return request("/api/budgets", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  monthlyAdvice(month: string, tone: AdviceTone) {
    return request<AdviceResponse>(`/api/ai/monthly-advice?month=${month}&tone=${tone}`);
  },
  settingsStatus() {
    return request<SettingsStatus>("/api/settings/public");
  },
  updateAiSettings(payload: AiSettingsPayload) {
    return request<SettingsStatus>("/api/settings/ai", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  testAiProviders(slot: "all" | "primary" | "backup" = "all") {
    return request<AiProviderTestResult[]>("/api/settings/ai/test", {
      method: "POST",
      body: JSON.stringify({ slot }),
    });
  },
};
