import type { AdviceResponse, AdviceTone, AiProviderTestResult, AiSettingsPayload, BudgetPayload, MonthlyStats, ParseResult, SettingsStatus, Transaction } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
  retryNetwork?: boolean;
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { detail?: string | Array<{ msg?: string }> };
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return "输入内容不符合要求，请检查金额、日期和必填字段。";
    }
  } catch {
    // The fallback below keeps server internals out of the interface.
  }
  if (response.status >= 500) return "后端暂时不可用，请稍后重试。";
  return `请求失败（${response.status}）`;
}

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const {
    timeoutMs = 75_000,
    retryNetwork = (options.method || "GET").toUpperCase() === "GET",
    ...fetchOptions
  } = options;
  const attempts = retryNetwork ? 2 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(fetchOptions.headers || {}),
        },
      });
      if (!response.ok) throw new Error(await responseErrorMessage(response));
      return response.json() as Promise<T>;
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      const isNetworkError = error instanceof TypeError;
      if (isNetworkError && attempt + 1 < attempts) {
        await wait(800);
        continue;
      }
      if (isAbort) throw new Error("请求等待时间过长，请稍后重试。");
      if (isNetworkError) {
        throw new Error("暂时无法连接后端，免费实例可能正在唤醒，请稍后重试。");
      }
      throw error instanceof Error ? error : new Error("请求失败，请稍后重试。");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  throw new Error("请求失败，请稍后重试。");
}

export const api = {
  parseTransaction(text: string) {
    return request<ParseResult>("/api/ai/parse-transaction", {
      method: "POST",
      body: JSON.stringify({ text }),
      timeoutMs: 100_000,
      retryNetwork: false,
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
    return request<AdviceResponse>(`/api/ai/monthly-advice?month=${month}&tone=${tone}`, {
      timeoutMs: 100_000,
    });
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
      timeoutMs: 100_000,
      retryNetwork: false,
    });
  },
};
