import { expect, test, type Page, type Route } from "@playwright/test";


const transaction = {
  id: 7,
  amount_cents: 2400,
  type: "expense",
  category: "饮品",
  account: "微信",
  occurred_at: "2026-07-11T20:30:00+08:00",
  note: "夜间咖啡",
  raw_text: "昨晚咖啡24元微信",
  tags: ["复习"],
  created_at: "2026-07-11T20:31:00+08:00",
};

function stats(month: string, balanceCents = 1000) {
  return {
    month,
    income_cents: balanceCents + 600,
    expense_cents: 600,
    balance_cents: balanceCents,
    budget_limit_cents: 180000,
    budget_remaining_cents: 179400,
    budget_usage_ratio: 0.0033,
    category_breakdown: [{ name: "饮品", amount_cents: 600 }],
    account_breakdown: [{ name: "支付宝", amount_cents: 600 }],
    daily_trend: [{ date: `${month}-01`, income_cents: balanceCents + 600, expense_cents: 600 }],
    recent_transactions: [transaction],
  };
}

const settings = {
  openai_base_url: "https://api.example/v1",
  openai_model: "test-model",
  api_key_configured: true,
  primary_base_url: "https://api.example/v1",
  primary_model: "test-model",
  primary_api_key_configured: true,
  backup_base_url: "",
  backup_model: "",
  backup_api_key_configured: false,
  backup_enabled: false,
  ai_request_timeout_seconds: 10,
  database_file: "test.db",
  runtime_settings_writable: false,
};

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
}

async function installStandardMocks(page: Page, captured: { create?: Record<string, unknown>; updates: number }) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/settings/public") return fulfillJson(route, settings);
    if (url.pathname === "/api/stats/monthly") return fulfillJson(route, stats(url.searchParams.get("month") || "2026-07"));
    if (url.pathname === "/api/transactions" && request.method() === "GET") return fulfillJson(route, [transaction]);
    if (url.pathname === "/api/ai/monthly-advice" && request.method() === "GET") {
      return fulfillJson(route, { status: "missing", advice: null, generated_at: null });
    }
    if (url.pathname === "/api/ai/parse-transaction") {
      return fulfillJson(route, {
        amount_cents: 5000,
        type: "expense",
        category: "餐饮",
        account: "微信",
        occurred_at: "2026-07-12T12:00:00+08:00",
        note: "午餐",
        raw_text: (request.postDataJSON() as { text: string }).text,
        tags: [],
        confidence: 0.92,
        source: "model",
        provider: "primary",
        missing_fields: [],
        needs_review: true,
      });
    }
    if (url.pathname === "/api/transactions" && request.method() === "POST") {
      captured.create = request.postDataJSON() as Record<string, unknown>;
      return fulfillJson(route, { id: 8, created_at: "2026-07-13T10:01:00+08:00", ...captured.create });
    }
    if (/\/api\/transactions\/\d+$/.test(url.pathname) && request.method() === "PUT") {
      captured.updates += 1;
      return fulfillJson(route, { ...transaction, ...(request.postDataJSON() as object) });
    }
    if (url.pathname === "/api/stats/weekly") {
      return fulfillJson(route, { week_start: "2026-07-06", week_end: "2026-07-12", income_cents: 0, expense_cents: 2400, balance_cents: -2400, transaction_count: 1 });
    }
    return fulfillJson(route, { ok: true });
  });
}


test("quick entry invalidates stale AI draft, saves edited time, and can cancel editing", async ({ page }) => {
  const captured: { create?: Record<string, unknown>; updates: number } = { updates: 0 };
  await installStandardMocks(page, captured);
  await page.goto("/");
  await expect(page.getByText("本月财务总览", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^AI 快记/ }).click();
  const description = page.getByLabel("自然语言账单描述");
  await page.getByRole("button", { name: "解析账单" }).click();
  await expect(page.getByText("主模型已完成解析")).toBeVisible();
  await expect(page.getByLabel("交易时间")).toHaveValue("2026-07-12T12:00");
  await expect(page.getByRole("button", { name: "确认入账" })).toBeEnabled();

  await description.fill("今天午餐改成了60元，微信付的");
  await expect(page.getByText("描述已修改，请重新解析")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认入账" })).toBeDisabled();

  await page.getByRole("button", { name: "重新解析" }).click();
  await expect(page.getByText("主模型已完成解析")).toBeVisible();
  await page.getByLabel("金额").fill("12.60");
  await page.getByLabel("交易时间").fill("2026-07-13T09:45");
  await page.getByRole("button", { name: "确认入账" }).click();
  await expect.poll(() => captured.create?.amount_cents).toBe(1260);
  expect(captured.create?.occurred_at).toBe("2026-07-13T09:45:00+08:00");

  await page.getByRole("button", { name: /^流水/ }).click();
  await page.getByRole("button", { name: "编辑夜间咖啡" }).click();
  await expect(page.getByText("正在编辑：夜间咖啡")).toBeVisible();
  await expect(page.getByLabel("交易时间")).toHaveValue("2026-07-11T20:30");
  await page.getByRole("button", { name: "取消编辑" }).click();
  await expect(page.getByRole("heading", { name: "确认入账", exact: true })).toBeVisible();
  expect(captured.updates).toBe(0);
});


test("an older monthly error cannot overwrite the newest month", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/settings/public") return fulfillJson(route, settings);
    if (url.pathname === "/api/ai/monthly-advice") return fulfillJson(route, { status: "missing", advice: null, generated_at: null });
    if (url.pathname === "/api/transactions") {
      const month = url.searchParams.get("month") || "2026-07";
      if (month === "2026-05") await new Promise((resolve) => setTimeout(resolve, 320));
      if (month === "2026-06") await new Promise((resolve) => setTimeout(resolve, 20));
      return fulfillJson(route, []);
    }
    if (url.pathname === "/api/stats/monthly") {
      const month = url.searchParams.get("month") || "2026-07";
      if (month === "2026-05") {
        await new Promise((resolve) => setTimeout(resolve, 320));
        return fulfillJson(route, { detail: "旧月份失败" }, 500);
      }
      if (month === "2026-06") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return fulfillJson(route, stats(month, 6000));
      }
      return fulfillJson(route, stats(month, 7000));
    }
    return fulfillJson(route, { ok: true });
  });

  await page.goto("/");
  await expect(page.getByText("+¥70.00")).toBeVisible();
  const monthInput = page.getByLabel("选择统计月份");
  await monthInput.fill("2026-05");
  await monthInput.fill("2026-06");
  await expect(page.getByText("+¥60.00")).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.getByText("+¥60.00")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});


test("desktop and mobile keep all six views within the viewport", async ({ page }) => {
  const captured: { create?: Record<string, unknown>; updates: number } = { updates: 0 };
  await installStandardMocks(page, captured);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const views = ["总览", "AI 快记", "流水", "分析", "预算"];
    for (const view of views) {
      await page.getByRole("button", { name: new RegExp(`^${view}`) }).click();
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(hasOverflow, `${view} ${viewport.width}px should not overflow`).toBe(false);
      if (view === "AI 快记") {
        await page.screenshot({ path: `test-results/quick-entry-${viewport.width}.png`, fullPage: true });
      }
    }
    await page.getByRole("button", { name: viewport.width <= 760 ? "打开设置" : /^设置/ }).click();
    await expect(page.getByRole("button", { name: "刷新 AI 设置" })).toBeVisible();
    await expect(page.getByLabel("选择统计月份")).toHaveCount(0);
    const settingsOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(settingsOverflow, `settings ${viewport.width}px should not overflow`).toBe(false);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: /^分析/ }).click();
  const legendStyles = await page.locator(".pie-legend span").evaluateAll((items) =>
    items.map((item) => getComputedStyle(item).whiteSpace),
  );
  expect(legendStyles.every((value) => value === "nowrap")).toBe(true);
});
