import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowClockwise,
  Brain,
  ChartLineUp,
  ChartPieSlice,
  CheckCircle,
  Coins,
  Command,
  Database,
  GearSix,
  Key,
  PencilSimple,
  Plus,
  Receipt,
  ShieldCheck,
  Tag,
  Trash,
  Wallet,
  X,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";
import { apiIsoToDateTimeLocal, businessDateKey, businessTimeLabel, currentBusinessIso, dateTimeLocalToApiIso } from "./businessTime";
import { centsToYuan, isoWeekKey, isoWeekRange, monthKey, yuanTextToCents } from "./money";
import type { AdviceResponse, AdviceSnapshot, AdviceTone, AiProviderTestResult, AiSettingsPayload, MonthlyStats, ParseResult, SettingsStatus, Transaction, TransactionType, WeeklyStats } from "./types";

type ViewKey = "overview" | "quick" | "transactions" | "analytics" | "budget" | "settings";
type DataStatus = "loading" | "waking" | "ready" | "error";
type AdviceBusyState = "idle" | "cache" | "generate";
type LedgerPeriod = "month" | "week";
type TransactionDraft = Omit<Transaction, "id" | "created_at" | "type"> & { type: TransactionType | "" };
type LedgerSummary = Pick<WeeklyStats, "income_cents" | "expense_cents" | "balance_cents" | "transaction_count">;

const emptyAdviceSnapshot: AdviceSnapshot = {
  status: "missing",
  advice: null,
  generated_at: null,
};

function createEmptyDraft(): TransactionDraft {
  return {
    amount_cents: 0,
    type: "expense",
    category: "餐饮",
    account: "微信",
    occurred_at: currentBusinessIso(),
    note: "",
    raw_text: "",
    tags: [],
  };
}

const categories = ["餐饮", "饮品", "交通", "娱乐", "学习", "购物", "住房", "医疗", "兼职", "收入", "其他"];
const accounts = ["微信", "支付宝", "银行卡", "现金", "未指定"];
const pieColors = ["#276f79", "#a8844f", "#735a73", "#53697f", "#08776d", "#aa6f58"];

const navItems: Array<{ key: ViewKey; label: string; helper: string; icon: ReactNode }> = [
  { key: "overview", label: "总览", helper: "收支与预算", icon: <ChartLineUp size={20} /> },
  { key: "quick", label: "AI 快记", helper: "一句话记账", icon: <Brain size={20} /> },
  { key: "transactions", label: "流水", helper: "月度与周度", icon: <Receipt size={20} /> },
  { key: "analytics", label: "分析", helper: "趋势与分布", icon: <ChartPieSlice size={20} /> },
  { key: "budget", label: "预算", helper: "额度与建议", icon: <ShieldCheck size={20} /> },
  { key: "settings", label: "设置", helper: "AI 模型", icon: <GearSix size={20} /> },
];

const pageCopy: Record<ViewKey, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: "财务中枢",
    title: "本月财务总览",
    description: "查看本月收支、预算余额和主要消费去向。",
  },
  quick: {
    eyebrow: "智能录入",
    title: "一句话记账",
    description: "描述一笔收入或支出，核对账单信息后保存。",
  },
  transactions: {
    eyebrow: "账本流水",
    title: "收支流水",
    description: "按月或按周查看收入、支出和每笔明细。",
  },
  analytics: {
    eyebrow: "数据洞察",
    title: "消费分析",
    description: "查看消费趋势、分类占比和常用付款账户。",
  },
  budget: {
    eyebrow: "预算管理",
    title: "月度预算",
    description: "设置本月预算，查看剩余额度和消费建议。",
  },
  settings: {
    eyebrow: "模型设置",
    title: "AI 设置",
    description: "配置用于智能记账和财务点评的模型服务。",
  },
};

interface ApiSettingsDraft {
  primary_base_url: string;
  primary_model: string;
  backup_base_url: string;
  backup_model: string;
  ai_request_timeout_seconds: string;
}

const defaultApiSettings: ApiSettingsDraft = {
  primary_base_url: "https://api.openai.com/v1",
  primary_model: "your-model-name",
  backup_base_url: "",
  backup_model: "",
  ai_request_timeout_seconds: "45",
};

function App() {
  const [activeView, setActiveView] = useState<ViewKey>("overview");
  const [month, setMonth] = useState(monthKey());
  const [ledgerPeriod, setLedgerPeriod] = useState<LedgerPeriod>("month");
  const [week, setWeek] = useState(isoWeekKey());
  const [stats, setStats] = useState<MonthlyStats | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null);
  const [weeklyTransactions, setWeeklyTransactions] = useState<Transaction[]>([]);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [adviceSnapshot, setAdviceSnapshot] = useState<AdviceSnapshot>(emptyAdviceSnapshot);
  const [adviceBusy, setAdviceBusy] = useState<AdviceBusyState>("idle");
  const [adviceError, setAdviceError] = useState("");
  const [tone, setTone] = useState<AdviceTone>("sharp");
  const [quickText, setQuickText] = useState("今天中午和室友吃疯狂星期四花了 50 块，微信付的");
  const [draft, setDraft] = useState<TransactionDraft>(() => createEmptyDraft());
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parsedSourceText, setParsedSourceText] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [budgetYuan, setBudgetYuan] = useState("1800");
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus | null>(null);
  const [apiDraft, setApiDraft] = useState<ApiSettingsDraft>(defaultApiSettings);
  const [apiSecretDraft, setApiSecretDraft] = useState("");
  const [backupSecretDraft, setBackupSecretDraft] = useState("");
  const [providerTests, setProviderTests] = useState<AiProviderTestResult[]>([]);
  const [providerTesting, setProviderTesting] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus>("loading");
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const adviceRequestId = useRef(0);
  const monthlyRequestId = useRef(0);
  const weeklyRequestId = useRef(0);
  const adviceScope = useRef("");

  const displayStats = stats ?? {
    income_cents: 0,
    expense_cents: 0,
    balance_cents: 0,
    budget_limit_cents: 0,
    budget_remaining_cents: 0,
    budget_usage_ratio: 0,
    category_breakdown: [],
    account_breakdown: [],
    daily_trend: [],
    recent_transactions: [],
    month,
  };
  const budgetStatus = useMemo(() => {
    if (!stats?.budget_limit_cents) return "未设置";
    if (stats.budget_usage_ratio >= 1) return "已超支";
    if (stats.budget_usage_ratio >= 0.8) return "接近上限";
    return "健康";
  }, [stats]);

  const topCategory = displayStats.category_breakdown[0];
  const topAccount = displayStats.account_breakdown[0];
  const activeDays = Math.max(displayStats.daily_trend.length, 1);
  const averageDailyExpense = Math.round(displayStats.expense_cents / activeDays);
  const weekRange = useMemo(() => isoWeekRange(week), [week]);
  const ledgerTransactions = ledgerPeriod === "week" ? weeklyTransactions : transactions;
  const groupedTransactions = useMemo(() => groupTransactionsByDate(ledgerTransactions), [ledgerTransactions]);
  const ledgerSummary: LedgerSummary = ledgerPeriod === "week"
    ? weeklyStats ?? { income_cents: 0, expense_cents: 0, balance_cents: 0, transaction_count: 0 }
    : {
        income_cents: displayStats.income_cents,
        expense_cents: displayStats.expense_cents,
        balance_cents: displayStats.balance_cents,
        transaction_count: transactions.length,
      };
  const ledgerPeriodLabel = ledgerPeriod === "week"
    ? formatWeekLabel(weekRange.start, weekRange.end)
    : formatMonthLabel(month);
  const envPreview = [
    `OPENAI_COMPATIBLE_BASE_URL=${apiDraft.primary_base_url || "https://api.openai.com/v1"}`,
    `OPENAI_COMPATIBLE_MODEL=${apiDraft.primary_model || "your-model-name"}`,
    "OPENAI_COMPATIBLE_API_KEY=sk-...",
    `BACKUP_OPENAI_COMPATIBLE_BASE_URL=${apiDraft.backup_base_url || ""}`,
    `BACKUP_OPENAI_COMPATIBLE_MODEL=${apiDraft.backup_model || ""}`,
    "BACKUP_OPENAI_COMPATIBLE_API_KEY=sk-...",
    `AI_REQUEST_TIMEOUT_SECONDS=${apiDraft.ai_request_timeout_seconds || "45"}`,
  ].join("\n");

  async function refresh(resetData = false) {
    const requestId = ++monthlyRequestId.current;
    const requestMonth = month;
    setError("");
    if (resetData) {
      setStats(null);
      setTransactions([]);
    }
    setDataStatus(resetData || !stats ? "loading" : "ready");
    const wakeTimer = window.setTimeout(() => {
      if (requestId === monthlyRequestId.current) {
        setDataStatus((current) => current === "loading" ? "waking" : current);
      }
    }, 1200);
    try {
      const [nextStats, nextTransactions] = await Promise.all([
        api.monthlyStats(requestMonth),
        api.listTransactions(requestMonth),
      ]);
      if (requestId !== monthlyRequestId.current) return;
      setStats(nextStats);
      setTransactions(nextTransactions);
      setBudgetYuan(String(nextStats.budget_limit_cents / 100));
      setDataStatus("ready");
    } catch (err) {
      if (requestId === monthlyRequestId.current) {
        setError(err instanceof Error ? err.message : "加载失败");
        setDataStatus("error");
      }
    } finally {
      window.clearTimeout(wakeTimer);
    }
  }

  async function refreshWeekly(resetData = false) {
    const requestId = ++weeklyRequestId.current;
    setError("");
    if (resetData) {
      setWeeklyStats(null);
      setWeeklyTransactions([]);
    }
    setWeeklyLoading(true);
    const range = isoWeekRange(week);
    try {
      const [nextStats, nextTransactions] = await Promise.all([
        api.weeklyStats(range.start),
        api.listTransactionsByDateRange(range.start, range.end),
      ]);
      if (requestId !== weeklyRequestId.current) return;
      setWeeklyStats(nextStats);
      setWeeklyTransactions(nextTransactions);
    } catch (err) {
      if (requestId === weeklyRequestId.current) {
        setError(err instanceof Error ? err.message : "本周流水加载失败");
      }
    } finally {
      if (requestId === weeklyRequestId.current) setWeeklyLoading(false);
    }
  }

  async function loadCachedAdvice(force = false) {
    const scope = `${month}:${tone}`;
    if (!force && adviceScope.current === scope) return;
    adviceScope.current = scope;
    const requestId = ++adviceRequestId.current;
    setAdviceSnapshot(emptyAdviceSnapshot);
    setAdviceBusy("cache");
    setAdviceError("");
    try {
      const nextSnapshot = await api.monthlyAdviceSnapshot(month, tone);
      if (requestId === adviceRequestId.current) setAdviceSnapshot(nextSnapshot);
    } catch (err) {
      if (requestId === adviceRequestId.current) {
        adviceScope.current = "";
        setAdviceError(err instanceof Error ? err.message : "读取已保存点评失败");
      }
    } finally {
      if (requestId === adviceRequestId.current) setAdviceBusy("idle");
    }
  }

  async function generateAdvice() {
    adviceScope.current = `${month}:${tone}`;
    const requestId = ++adviceRequestId.current;
    setAdviceBusy("generate");
    setAdviceError("");
    try {
      const nextSnapshot = await api.generateMonthlyAdvice(month, tone);
      if (requestId === adviceRequestId.current) setAdviceSnapshot(nextSnapshot);
    } catch (err) {
      if (requestId === adviceRequestId.current) {
        setAdviceError(err instanceof Error ? err.message : "AI 点评生成失败");
      }
    } finally {
      if (requestId === adviceRequestId.current) setAdviceBusy("idle");
    }
  }

  function markAdviceStale() {
    adviceRequestId.current += 1;
    setAdviceBusy("idle");
    setAdviceSnapshot((current) => current.advice ? { ...current, status: "stale" } : emptyAdviceSnapshot);
  }

  async function loadSettings(showError = false) {
    if (showError) setError("");
    try {
      const nextSettings = await api.settingsStatus();
      setSettingsStatus(nextSettings);
      setApiDraft({
        primary_base_url: nextSettings.primary_base_url || nextSettings.openai_base_url,
        primary_model: nextSettings.primary_model || nextSettings.openai_model,
        backup_base_url: nextSettings.backup_base_url || "",
        backup_model: nextSettings.backup_model || "",
        ai_request_timeout_seconds: String(nextSettings.ai_request_timeout_seconds || 45),
      });
    } catch (err) {
      setSettingsStatus(null);
      if (showError) setError(err instanceof Error ? err.message : "设置读取失败");
    }
  }

  useEffect(() => {
    refresh(true);
  }, [month]);

  useEffect(() => {
    if (activeView === "transactions" && ledgerPeriod === "week") refreshWeekly(true);
  }, [activeView, ledgerPeriod, week]);

  useEffect(() => {
    if (activeView === "overview" || activeView === "budget") loadCachedAdvice();
  }, [activeView, month, tone]);

  useEffect(() => {
    loadSettings();
  }, []);

  async function parseQuickEntry() {
    if (!quickText.trim()) {
      setError("请先输入一笔收入或支出描述");
      return;
    }
    if (editingId) {
      setError("请先取消当前编辑，再解析新账单");
      return;
    }
    const sourceText = quickText;
    setLoading(true);
    setError("");
    try {
      const result = await api.parseTransaction(quickText);
      setParsed(result);
      setParsedSourceText(sourceText);
      setDraft({
        amount_cents: result.amount_cents,
        type: result.missing_fields.includes("type") ? "" : result.type,
        category: result.missing_fields.includes("category") ? "" : result.category,
        account: result.missing_fields.includes("account") ? "" : result.account,
        occurred_at: result.missing_fields.includes("occurred_at") ? "" : result.occurred_at,
        note: result.note,
        raw_text: result.raw_text,
        tags: result.tags || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析失败，请手动录入");
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft(nextDraft: TransactionDraft) {
    if (!editingId && parsed && parsedSourceText !== quickText) {
      setError("描述已修改，请重新解析后再确认入账");
      return;
    }
    setLoading(true);
    setError("");
    const wasEditing = Boolean(editingId);
    try {
      if (!nextDraft.type) {
        setError("请选择收入或支出类型");
        return;
      }
      const payload: Omit<Transaction, "id" | "created_at"> = {
        ...nextDraft,
        type: nextDraft.type,
      };
      if (editingId) {
        await api.updateTransaction(editingId, payload);
      } else {
        await api.createTransaction(payload);
      }
      setEditingId(null);
      setParsed(null);
      setParsedSourceText(null);
      setQuickText("");
      setDraft(createEmptyDraft());
      await refresh();
      if (ledgerPeriod === "week") await refreshWeekly();
      markAdviceStale();
      setActiveView(wasEditing ? "transactions" : "overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  async function saveBudget() {
    setError("");
    try {
      await api.setBudget({ month, limit_cents: yuanTextToCents(budgetYuan), category: null });
      await refresh();
      markAdviceStale();
    } catch (err) {
      setError(err instanceof Error ? err.message : "预算保存失败");
    }
  }

  async function removeTransaction(id: number) {
    setDeleting(true);
    setError("");
    try {
      await api.deleteTransaction(id);
      setPendingDelete(null);
      await refresh();
      if (ledgerPeriod === "week") await refreshWeekly();
      markAdviceStale();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败，请稍后重试");
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  function editTransaction(item: Transaction) {
    setEditingId(item.id);
    setDraft({
      amount_cents: item.amount_cents,
      type: item.type,
      category: item.category,
      account: item.account,
      occurred_at: item.occurred_at,
      note: item.note,
      raw_text: item.raw_text || "",
      tags: item.tags || [],
    });
    setQuickText(item.raw_text || item.note || "");
    setParsed(null);
    setParsedSourceText(null);
    setActiveView("quick");
  }

  function cancelEditing() {
    setEditingId(null);
    setParsed(null);
    setParsedSourceText(null);
    setQuickText("");
    setDraft(createEmptyDraft());
    setError("");
  }

  function openNewTransaction() {
    cancelEditing();
    setActiveView("quick");
  }

  async function saveApiSettings() {
    setError("");
    try {
      const payload: AiSettingsPayload = {
        primary_base_url: apiDraft.primary_base_url,
        primary_model: apiDraft.primary_model,
        primary_api_key: apiSecretDraft || null,
        backup_base_url: apiDraft.backup_base_url,
        backup_model: apiDraft.backup_model,
        backup_api_key: backupSecretDraft || null,
        ai_request_timeout_seconds: Number(apiDraft.ai_request_timeout_seconds || 45),
      };
      const nextSettings = await api.updateAiSettings(payload);
      setSettingsStatus(nextSettings);
      setApiDraft({
        primary_base_url: nextSettings.primary_base_url,
        primary_model: nextSettings.primary_model,
        backup_base_url: nextSettings.backup_base_url || "",
        backup_model: nextSettings.backup_model || "",
        ai_request_timeout_seconds: String(nextSettings.ai_request_timeout_seconds),
      });
      setApiSecretDraft("");
      setBackupSecretDraft("");
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存 API 设置失败");
    }
  }

  async function testAiProviders() {
    setProviderTesting(true);
    setError("");
    try {
      const results = await api.testAiProviders("all");
      setProviderTests(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "测试 AI 接口失败");
    } finally {
      setProviderTesting(false);
    }
  }

  function refreshCurrentView() {
    if (activeView === "settings") {
      loadSettings(true);
      return;
    }
    if (activeView === "transactions" && ledgerPeriod === "week") {
      refreshWeekly();
      return;
    }
    refresh();
    if (activeView === "overview" || activeView === "budget") loadCachedAdvice(true);
  }

  const page = pageCopy[activeView];
  const requiresStats = activeView !== "quick" && activeView !== "settings";

  return (
    <main className="app-root">
      <div className="app-shell">
        <header className="mobile-header">
          <div className="brand-zone">
            <div className="brand-mark">
              <Wallet size={22} weight="duotone" />
            </div>
            <div>
              <strong>口袋记账</strong>
              <span>智能账本</span>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={() => setActiveView("settings")}
            aria-label="打开设置"
            aria-current={activeView === "settings" ? "page" : undefined}
          >
            <GearSix size={20} />
          </button>
        </header>

        <aside className="side-rail">
          <div className="side-rail-sticky">
            <div className="brand-zone">
              <div className="brand-mark">
                <Wallet size={25} weight="duotone" />
              </div>
              <div>
                <strong>口袋记账</strong>
                <span>智能账本</span>
              </div>
            </div>
            <nav className="rail-nav" aria-label="主导航">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  className={`rail-item ${activeView === item.key ? "active" : ""}`}
                  onClick={() => setActiveView(item.key)}
                  aria-current={activeView === item.key ? "page" : undefined}
                >
                  {item.icon}
                  <span>
                    <b>{item.label}</b>
                    <small>{item.helper}</small>
                  </span>
                </button>
              ))}
            </nav>
            <div className="rail-note">
              <span>账本状态</span>
              <strong>自动保存</strong>
              <small>{settingsStatus?.api_key_configured ? "AI 快记已就绪" : "可手动记账"}</small>
            </div>
          </div>
        </aside>

        <section className="workspace">
          <header className="topbar">
            <div className="page-title">
              <span>{page.eyebrow}</span>
              <h1>{page.title}</h1>
              <p>{page.description}</p>
            </div>
            {activeView !== "quick" && (
              <div className="top-actions">
                {activeView !== "settings" && (activeView === "transactions" && ledgerPeriod === "week" ? (
                  <input aria-label="选择统计周" type="week" value={week} onChange={(event) => setWeek(event.target.value)} />
                ) : (
                  <input aria-label="选择统计月份" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
                ))}
                <button
                  className="icon-button"
                  onClick={refreshCurrentView}
                  aria-label={activeView === "settings" ? "刷新 AI 设置" : "刷新当前数据"}
                >
                  <ArrowClockwise size={18} />
                </button>
              </div>
            )}
          </header>

          {error && <div className="error-strip" role="alert">{error}</div>}

          <section className="page-frame" aria-live="polite" aria-busy={requiresStats && (dataStatus === "loading" || dataStatus === "waking")}>
            {requiresStats && !stats ? (
              <DataLoadState status={dataStatus} onRetry={() => refresh(true)} />
            ) : <>
              {activeView === "overview" && (
              <OverviewPage
                displayStats={displayStats}
                budgetStatus={budgetStatus}
                transactionCount={transactions.length}
                adviceSnapshot={adviceSnapshot}
                adviceBusy={adviceBusy}
                adviceError={adviceError}
                generateAdvice={generateAdvice}
                tone={tone}
                setTone={setTone}
                topCategory={topCategory}
                topAccount={topAccount}
                averageDailyExpense={averageDailyExpense}
                activeDays={activeDays}
                settingsStatus={settingsStatus}
                onOpenQuick={openNewTransaction}
                onOpenAnalytics={() => setActiveView("analytics")}
              />
              )}

              {activeView === "quick" && (
              <QuickEntryPage
                quickText={quickText}
                setQuickText={setQuickText}
                parsed={parsed}
                draft={draft}
                setDraft={setDraft}
                loading={loading}
                editingId={editingId}
                parsedSourceText={parsedSourceText}
                parseQuickEntry={parseQuickEntry}
                saveDraft={saveDraft}
                cancelEditing={cancelEditing}
              />
              )}

              {activeView === "transactions" && (
              <TransactionsPage
                transactions={ledgerTransactions}
                groupedTransactions={groupedTransactions}
                period={ledgerPeriod}
                setPeriod={setLedgerPeriod}
                periodLabel={ledgerPeriodLabel}
                summary={ledgerSummary}
                loading={weeklyLoading && ledgerPeriod === "week"}
                editTransaction={editTransaction}
                requestDelete={setPendingDelete}
                onOpenQuick={openNewTransaction}
              />
              )}

              {activeView === "analytics" && (
              <AnalyticsPage
                displayStats={displayStats}
                topCategory={topCategory}
                topAccount={topAccount}
                averageDailyExpense={averageDailyExpense}
                activeDays={activeDays}
              />
              )}

              {activeView === "budget" && (
              <BudgetPage
                displayStats={displayStats}
                budgetStatus={budgetStatus}
                budgetYuan={budgetYuan}
                setBudgetYuan={setBudgetYuan}
                saveBudget={saveBudget}
                adviceSnapshot={adviceSnapshot}
                adviceBusy={adviceBusy}
                adviceError={adviceError}
                generateAdvice={generateAdvice}
                tone={tone}
                setTone={setTone}
              />
              )}

              {activeView === "settings" && (
              <SettingsPage
                settingsStatus={settingsStatus}
                apiDraft={apiDraft}
                setApiDraft={setApiDraft}
                apiSecretDraft={apiSecretDraft}
                setApiSecretDraft={setApiSecretDraft}
                backupSecretDraft={backupSecretDraft}
                setBackupSecretDraft={setBackupSecretDraft}
                providerTests={providerTests}
                providerTesting={providerTesting}
                settingsSaved={settingsSaved}
                saveApiSettings={saveApiSettings}
                testAiProviders={testAiProviders}
                envPreview={envPreview}
              />
              )}
            </>}
          </section>
        </section>

        <nav className="mobile-nav" aria-label="手机主导航">
          {navItems.filter((item) => item.key !== "settings").map((item) => (
            <button
              key={item.key}
              className={activeView === item.key ? "active" : ""}
              onClick={() => setActiveView(item.key)}
              aria-current={activeView === item.key ? "page" : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <DeleteTransactionDialog
        transaction={pendingDelete}
        deleting={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={(id) => removeTransaction(id)}
      />
    </main>
  );
}

function DataLoadState({ status, onRetry }: { status: DataStatus; onRetry: () => void }) {
  if (status === "error") {
    return (
      <section className="panel recovery-state">
        <Database size={28} />
        <div>
          <h2>暂时无法读取账本</h2>
          <p>服务暂时没有响应，请稍后重试。</p>
        </div>
        <button className="primary-button" onClick={onRetry}>重新加载账本</button>
      </section>
    );
  }
  return (
    <section className="panel loading-state">
      <div className="loading-copy">
        <span className="loading-pulse" />
        <div>
          <h2>{status === "waking" ? "连接时间比平时稍长" : "正在打开账本"}</h2>
          <p>{status === "waking" ? "服务正在恢复，请稍候。" : "正在同步本月流水和预算。"}</p>
        </div>
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        <span /><span /><span />
      </div>
    </section>
  );
}

function DeleteTransactionDialog({
  transaction,
  deleting,
  onCancel,
  onConfirm,
}: {
  transaction: Transaction | null;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: (id: number) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (transaction && !dialog.open) dialog.showModal();
    if (!transaction && dialog.open) dialog.close();
  }, [transaction]);

  return (
    <dialog
      className="confirm-dialog"
      ref={dialogRef}
      aria-labelledby="delete-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onCancel();
      }}
    >
      {transaction && <>
        <div className="dialog-icon"><Trash size={22} /></div>
        <div>
          <h2 id="delete-dialog-title">删除这笔流水？</h2>
          <p>{transaction.note || transaction.category}，{transaction.type === "income" ? "+" : "-"}¥{centsToYuan(transaction.amount_cents)}</p>
        </div>
        <div className="dialog-actions">
          <button className="ghost-button" onClick={onCancel} disabled={deleting}>保留流水</button>
          <button className="danger-button" onClick={() => onConfirm(transaction.id)} disabled={deleting}>
            {deleting ? "正在删除" : "删除流水"}
          </button>
        </div>
      </>}
    </dialog>
  );
}

function OverviewPage({
  displayStats,
  budgetStatus,
  transactionCount,
  adviceSnapshot,
  adviceBusy,
  adviceError,
  generateAdvice,
  tone,
  setTone,
  topCategory,
  topAccount,
  averageDailyExpense,
  activeDays,
  settingsStatus,
  onOpenQuick,
  onOpenAnalytics,
}: {
  displayStats: MonthlyStats;
  budgetStatus: string;
  transactionCount: number;
  adviceSnapshot: AdviceSnapshot;
  adviceBusy: AdviceBusyState;
  adviceError: string;
  generateAdvice: () => void;
  tone: AdviceTone;
  setTone: (tone: AdviceTone) => void;
  topCategory?: { name: string; amount_cents: number };
  topAccount?: { name: string; amount_cents: number };
  averageDailyExpense: number;
  activeDays: number;
  settingsStatus: SettingsStatus | null;
  onOpenQuick: () => void;
  onOpenAnalytics: () => void;
}) {
  const budgetPercent = Math.round(displayStats.budget_usage_ratio * 100);
  const advice = adviceSnapshot.advice;
  const aiRuntimeLabel = adviceBusy === "generate"
    ? "模型分析中"
    : adviceSnapshot.status === "stale"
      ? "点评待更新"
      : advice
        ? providerLabel(advice.provider)
        : settingsStatus?.api_key_configured ? "点评待生成" : "基础点评待生成";
  return (
    <div className="overview-page page-stack">
      <section className="command-board">
        <div className="board-main">
          <div className="board-toolbar" aria-label="本月总览控制条">
            <span>预算 {budgetPercent}%</span>
            <span>{transactionCount} 笔流水</span>
            <span>{aiRuntimeLabel}</span>
          </div>
          <div className="board-copy">
            <span className="kicker">月度净现金流</span>
            <strong className={displayStats.balance_cents >= 0 ? "positive" : "negative"}>
              {displayStats.balance_cents >= 0 ? "+" : "-"}¥{centsToYuan(Math.abs(displayStats.balance_cents))}
            </strong>
            <p>{budgetStatus === "健康" ? `本月预算剩余 ¥${centsToYuan(displayStats.budget_remaining_cents)}` : `本月预算${budgetStatus}`}</p>
            <div className="board-actions">
              <button className="primary-button" onClick={onOpenQuick}>
                <Command size={18} />
                记录一笔
              </button>
              <button className="ghost-button" onClick={onOpenAnalytics}>
                <ChartPieSlice size={18} />
                查看分析
              </button>
            </div>
          </div>
        </div>
        <div className="board-side">
          <StatusLine label="预算状态" value={budgetStatus} />
          <StatusLine label="财务点评" value={aiRuntimeLabel} />
          <StatusLine label="记账天数" value={`${activeDays} 天`} />
        </div>
      </section>

      <section className="metric-grid">
        <Metric label="本月支出" value={`¥${centsToYuan(displayStats.expense_cents)}`} tone="expense" icon={<Coins size={22} />} />
        <Metric label="本月收入" value={`¥${centsToYuan(displayStats.income_cents)}`} tone="income" icon={<Wallet size={22} />} />
        <Metric label="预算剩余" value={`¥${centsToYuan(displayStats.budget_remaining_cents)}`} tone={displayStats.budget_remaining_cents < 0 ? "danger" : "neutral"} icon={<ShieldCheck size={22} />} />
      </section>

      <section className="overview-grid">
        <div className="panel advice-panel">
          <AdvicePanelContent
            title="AI 财务点评"
            snapshot={adviceSnapshot}
            busy={adviceBusy}
            error={adviceError}
            tone={tone}
            setTone={setTone}
            onGenerate={generateAdvice}
          />
        </div>
        <div className="panel insight-panel">
          <div className="insight-grid">
            <Insight label="最高分类" value={topCategory?.name || "暂无"} detail={topCategory ? `¥${centsToYuan(topCategory.amount_cents)}` : "先记一笔"} />
            <Insight label="主要账户" value={topAccount?.name || "暂无"} detail={topAccount ? `¥${centsToYuan(topAccount.amount_cents)}` : "等待数据"} />
            <Insight label="日均支出" value={`¥${centsToYuan(averageDailyExpense)}`} detail={`${activeDays} 个活跃日`} />
            <Insight label="预算使用" value={`${Math.round(displayStats.budget_usage_ratio * 100)}%`} detail={`剩余 ¥${centsToYuan(displayStats.budget_remaining_cents)}`} />
          </div>
        </div>
      </section>
    </div>
  );
}

function QuickEntryPage({
  quickText,
  setQuickText,
  parsed,
  draft,
  setDraft,
  loading,
  editingId,
  parsedSourceText,
  parseQuickEntry,
  saveDraft,
  cancelEditing,
}: {
  quickText: string;
  setQuickText: (value: string) => void;
  parsed: ParseResult | null;
  draft: TransactionDraft;
  setDraft: (draft: TransactionDraft) => void;
  loading: boolean;
  editingId: number | null;
  parsedSourceText: string | null;
  parseQuickEntry: () => void;
  saveDraft: (draft: TransactionDraft) => void;
  cancelEditing: () => void;
}) {
  const parsedIsStale = Boolean(parsed && parsedSourceText !== quickText);
  const reportedMissingFields = parsed?.missing_fields.map(fieldDisplayName).join("、") || "";
  const blockingFields = requiredDraftFields(draft).map(fieldDisplayName).join("、");
  const statusLabel = editingId ? "编辑中" : parsedIsStale ? "待重新解析" : parsed ? "待确认" : "等待输入";
  return (
    <div className="quick-layout">
      <section className="panel quick-command">
        <div className="section-heading">
          <div>
            <span className="kicker">账单描述</span>
            <h2>AI 解析语义，<span className="no-break">手动确认入账</span></h2>
          </div>
          <span className="status-pill">{statusLabel}</span>
        </div>
        <textarea
          value={quickText}
          onChange={(event) => setQuickText(event.target.value)}
          placeholder="例如：今天中午和室友吃疯狂星期四花了 50 块，微信付的"
          readOnly={Boolean(editingId)}
          aria-label={editingId ? "原始账单描述" : "自然语言账单描述"}
        />
        <div className="button-row">
          <button className="primary-button" onClick={parseQuickEntry} disabled={loading || Boolean(editingId) || !quickText.trim()}>
            <Brain size={18} />
            {editingId ? "正在编辑流水" : loading ? "正在解析" : parsedIsStale ? "重新解析" : "解析账单"}
          </button>
        </div>
        {parsed && (
          <div className={`parse-card ${parsedIsStale ? "stale" : ""}`} role={parsedIsStale ? "alert" : undefined}>
            <CheckCircle size={20} weight="fill" />
            <div>
              <strong>{parsedIsStale ? "描述已修改，请重新解析" : `${parseSourceLabel(parsed)}已完成解析`}</strong>
              <span>
                {parsedIsStale
                  ? "右侧保留上一次草稿，仅供对照，暂时不能入账。"
                  : blockingFields
                    ? `请补充：${blockingFields}`
                    : reportedMissingFields
                      ? `AI 未确定：${reportedMissingFields}，请核对右侧字段`
                      : "请核对右侧账单信息"}
              </span>
            </div>
          </div>
        )}
      </section>
      <section className="panel form-panel">
        <div className="section-heading">
          <div>
            <span className="kicker">账单信息</span>
            <h2>{editingId ? "编辑流水" : "确认入账"}</h2>
          </div>
          {editingId && (
            <div className="editing-badge">
              <PencilSimple size={16} />
              正在编辑：{draft.note || draft.category}
            </div>
          )}
        </div>
        <TransactionForm
          draft={draft}
          setDraft={setDraft}
          onSave={saveDraft}
          editingId={editingId}
          busy={loading}
          saveBlocked={parsedIsStale || Boolean(parsed && parsed.missing_fields.some((field) => isDraftFieldUnresolved(field, draft)))}
          onCancelEditing={cancelEditing}
        />
      </section>
    </div>
  );
}

function TransactionsPage({
  transactions,
  groupedTransactions,
  period,
  setPeriod,
  periodLabel,
  summary,
  loading,
  editTransaction,
  requestDelete,
  onOpenQuick,
}: {
  transactions: Transaction[];
  groupedTransactions: TransactionDateGroup[];
  period: LedgerPeriod;
  setPeriod: (period: LedgerPeriod) => void;
  periodLabel: string;
  summary: LedgerSummary;
  loading: boolean;
  editTransaction: (item: Transaction) => void;
  requestDelete: (item: Transaction) => void;
  onOpenQuick: () => void;
}) {
  return (
    <section className="panel ledger-panel" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <span className="kicker">收支明细</span>
          <h2>{period === "week" ? "周度流水" : "月度流水"}</h2>
        </div>
        <div className="ledger-heading-actions">
          <div className="segmented" aria-label="流水统计周期">
            <button aria-pressed={period === "month"} className={period === "month" ? "selected" : ""} onClick={() => setPeriod("month")}>按月</button>
            <button aria-pressed={period === "week"} className={period === "week" ? "selected" : ""} onClick={() => setPeriod("week")}>按周</button>
          </div>
          <span className="status-pill">{summary.transaction_count} 笔</span>
        </div>
      </div>
      <div className="ledger-summary" aria-label={`${periodLabel}收支统计`}>
        <div className="ledger-period-label">
          <span>统计周期</span>
          <strong>{periodLabel}</strong>
        </div>
        <div>
          <span>收入</span>
          <strong className="positive">+¥{centsToYuan(summary.income_cents)}</strong>
        </div>
        <div>
          <span>支出</span>
          <strong className="negative">-¥{centsToYuan(summary.expense_cents)}</strong>
        </div>
        <div>
          <span>净额</span>
          <strong className={summary.balance_cents >= 0 ? "positive" : "negative"}>
            {summary.balance_cents >= 0 ? "+" : "-"}¥{centsToYuan(Math.abs(summary.balance_cents))}
          </strong>
        </div>
      </div>
      {loading ? (
        <div className="ledger-loading">正在读取本周流水</div>
      ) : <div className="transaction-list">
        {transactions.length === 0 ? (
          <div className="ledger-empty">
            <span>{period === "week" ? "本周暂无流水。" : "本月暂无流水。"}</span>
            <button className="ghost-button" onClick={onOpenQuick}>记录一笔</button>
          </div>
        ) : (
          groupedTransactions.map((group) => (
            <section className="date-group" key={group.date}>
              <div className="date-header">
                <div>
                  <strong>{formatDay(group.date)}</strong>
                  <span>{group.items.length} 笔 · 支出 ¥{centsToYuan(group.expense_cents)} · 收入 ¥{centsToYuan(group.income_cents)}</span>
                </div>
                <b className={group.income_cents - group.expense_cents >= 0 ? "positive" : "negative"}>
                  {group.income_cents - group.expense_cents >= 0 ? "+" : "-"}¥{centsToYuan(Math.abs(group.income_cents - group.expense_cents))}
                </b>
              </div>
              {group.items.map((item) => (
                <div className="transaction-row" key={item.id}>
                  <div>
                    <strong>{item.note || item.category}</strong>
                    <span>{item.category} / {item.account} / {businessTimeLabel(item.occurred_at)}</span>
                    {item.tags?.length > 0 && (
                      <div className="row-tags">
                        {item.tags.map((tag) => <em key={`${item.id}-${tag}`}>#{tag}</em>)}
                      </div>
                    )}
                  </div>
                  <div className="row-actions">
                    <b className={item.type === "income" ? "positive" : ""}>{item.type === "income" ? "+" : "-"}¥{centsToYuan(item.amount_cents)}</b>
                    <button onClick={() => editTransaction(item)} aria-label={`编辑${item.note || item.category}`}><PencilSimple size={17} /></button>
                    <button onClick={() => requestDelete(item)} aria-label={`删除${item.note || item.category}`}><Trash size={17} /></button>
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>}
    </section>
  );
}

function AnalyticsPage({
  displayStats,
  topCategory,
  topAccount,
  averageDailyExpense,
  activeDays,
}: {
  displayStats: MonthlyStats;
  topCategory?: { name: string; amount_cents: number };
  topAccount?: { name: string; amount_cents: number };
  averageDailyExpense: number;
  activeDays: number;
}) {
  return (
    <div className="analytics-layout">
      <section className="panel chart-panel">
        <div className="section-heading">
          <div>
            <span className="kicker">趋势</span>
            <h2>消费趋势</h2>
          </div>
        </div>
        <div className="insight-grid">
          <Insight label="最高分类" value={topCategory?.name || "暂无"} detail={topCategory ? `¥${centsToYuan(topCategory.amount_cents)}` : "先记一笔"} />
          <Insight label="主要账户" value={topAccount?.name || "暂无"} detail={topAccount ? `¥${centsToYuan(topAccount.amount_cents)}` : "等待数据"} />
          <Insight label="日均支出" value={`¥${centsToYuan(averageDailyExpense)}`} detail={`${activeDays} 个活跃日`} />
          <Insight label="预算使用" value={`${Math.round(displayStats.budget_usage_ratio * 100)}%`} detail={`剩余 ¥${centsToYuan(displayStats.budget_remaining_cents)}`} />
        </div>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={330}>
            <AreaChart data={displayStats.daily_trend}>
              <defs>
                <linearGradient id="expenseGradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#276f79" stopOpacity={0.42} />
                  <stop offset="100%" stopColor="#a8844f" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#cfd8dc" strokeDasharray="2 8" vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#65717a", fontSize: 11 }}
                tickFormatter={(value) => formatChartDateShort(String(value))}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#65717a", fontSize: 11 }}
                tickFormatter={(value) => `¥${centsToYuan(Number(value))}`}
              />
              <Tooltip
                labelFormatter={(label) => formatChartDate(String(label))}
                formatter={(value) => [`¥${centsToYuan(Number(value))}`, "支出"]}
              />
              <Area name="支出" type="monotone" dataKey="expense_cents" stroke="#276f79" fill="url(#expenseGradient)" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
      <section className="analytics-side">
        <MiniPie title="分类占比" data={displayStats.category_breakdown} />
        <MiniPie title="账户分布" data={displayStats.account_breakdown} />
      </section>
    </div>
  );
}

function BudgetPage({
  displayStats,
  budgetStatus,
  budgetYuan,
  setBudgetYuan,
  saveBudget,
  adviceSnapshot,
  adviceBusy,
  adviceError,
  generateAdvice,
  tone,
  setTone,
}: {
  displayStats: MonthlyStats;
  budgetStatus: string;
  budgetYuan: string;
  setBudgetYuan: (value: string) => void;
  saveBudget: () => void;
  adviceSnapshot: AdviceSnapshot;
  adviceBusy: AdviceBusyState;
  adviceError: string;
  generateAdvice: () => void;
  tone: AdviceTone;
  setTone: (tone: AdviceTone) => void;
}) {
  return (
    <div className="budget-layout">
      <section className="panel budget-panel">
        <div className="section-heading">
          <div>
            <span className="kicker">风险线</span>
            <h2>预算状态</h2>
          </div>
          <span className={`status-pill ${budgetStatus === "已超支" ? "danger" : ""}`}>{budgetStatus}</span>
        </div>
        <div className="budget-ring">
          <div style={{ "--usage": `${Math.min(displayStats.budget_usage_ratio * 100, 100)}%` } as CSSProperties}>
            <span>{Math.round(displayStats.budget_usage_ratio * 100)}%</span>
          </div>
          <p>预算使用率</p>
        </div>
        <label className="field-block">
          <span>月度预算</span>
          <input value={budgetYuan} onChange={(event) => setBudgetYuan(event.target.value)} />
        </label>
        <button className="primary-button full" onClick={saveBudget}>保存预算</button>
      </section>
      <section className="panel advice-panel budget-advice">
        <AdvicePanelContent
          title="预算建议"
          snapshot={adviceSnapshot}
          busy={adviceBusy}
          error={adviceError}
          tone={tone}
          setTone={setTone}
          onGenerate={generateAdvice}
          showActions
        />
      </section>
    </div>
  );
}

function AdvicePanelContent({
  title,
  snapshot,
  busy,
  error,
  tone,
  setTone,
  onGenerate,
  showActions = false,
}: {
  title: string;
  snapshot: AdviceSnapshot;
  busy: AdviceBusyState;
  error: string;
  tone: AdviceTone;
  setTone: (tone: AdviceTone) => void;
  onGenerate: () => void;
  showActions?: boolean;
}) {
  const advice = snapshot.advice;
  const isGenerating = busy === "generate";
  const needsGeneration = snapshot.status !== "fresh" || advice?.source === "error_fallback";
  const badge = isGenerating
    ? "分析中"
    : busy === "cache"
      ? "读取中"
      : snapshot.status === "stale"
        ? "待更新"
        : advice ? providerLabel(advice.provider) : "尚未生成";
  const headline = advice?.headline || advice?.advice || (isGenerating ? "正在生成本月点评" : "本月还没有 AI 点评");
  const detail = advice?.detail || (
    isGenerating
      ? "正在分析本月收支和预算，请稍候。"
      : "生成一份基于本月收支与预算的财务建议。"
  );
  let statusMessage = "尚未生成本月点评";
  if (busy === "cache") statusMessage = "正在读取本月点评";
  else if (isGenerating) statusMessage = "正在生成新的财务点评";
  else if (snapshot.status === "stale") statusMessage = "本月账单已变化，建议重新分析";
  else if (advice?.source === "error_fallback") statusMessage = "AI 暂时不可用，已提供基础建议";
  else if (snapshot.generated_at) statusMessage = `更新于 ${formatAdviceTime(snapshot.generated_at)}`;

  return <>
    <div className="panel-title">
      <Brain size={20} />
      <span>{title}</span>
      <small className="provider-badge">{badge}</small>
    </div>
    <div className="advice-copy" aria-live="polite" aria-busy={busy !== "idle"}>
      <strong>{headline}</strong>
      <p>{detail}</p>
    </div>
    <div className={`advice-cache-state ${snapshot.status}`}>
      <CheckCircle size={16} />
      <span>{statusMessage}</span>
    </div>
    {showActions && advice?.action_items?.length ? (
      <div className="action-list">
        {advice.action_items.map((item) => <span key={item}>{item}</span>)}
      </div>
    ) : null}
    {error && <div className="advice-inline-error" role="alert">{error}</div>}
    <div className="advice-controls">
      <div className="segmented">
        <button disabled={busy !== "idle"} aria-pressed={tone === "sharp"} className={tone === "sharp" ? "selected" : ""} onClick={() => setTone("sharp")}>直接</button>
        <button disabled={busy !== "idle"} aria-pressed={tone === "warm"} className={tone === "warm" ? "selected" : ""} onClick={() => setTone("warm")}>温和</button>
      </div>
      {(needsGeneration || isGenerating) && (
        <button className="primary-button advice-generate-button" onClick={onGenerate} disabled={busy !== "idle"}>
          <Brain size={18} />
          {isGenerating ? "分析中" : advice ? "重新分析" : "生成点评"}
        </button>
      )}
    </div>
  </>;
}

function formatAdviceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "上次";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function SettingsPage({
  settingsStatus,
  apiDraft,
  setApiDraft,
  apiSecretDraft,
  setApiSecretDraft,
  backupSecretDraft,
  setBackupSecretDraft,
  providerTests,
  providerTesting,
  settingsSaved,
  saveApiSettings,
  testAiProviders,
  envPreview,
}: {
  settingsStatus: SettingsStatus | null;
  apiDraft: ApiSettingsDraft;
  setApiDraft: (value: ApiSettingsDraft) => void;
  apiSecretDraft: string;
  setApiSecretDraft: (value: string) => void;
  backupSecretDraft: string;
  setBackupSecretDraft: (value: string) => void;
  providerTests: AiProviderTestResult[];
  providerTesting: boolean;
  settingsSaved: boolean;
  saveApiSettings: () => void;
  testAiProviders: () => void;
  envPreview: string;
}) {
  const backupState = settingsStatus?.backup_enabled ? "备用已启用" : "备用未启用";
  const writable = settingsStatus?.runtime_settings_writable;
  return (
    <section className="panel settings-panel">
      <div className="section-heading">
        <div>
          <span className="kicker">模型服务</span>
          <h2>AI 模型配置</h2>
        </div>
        <span className="status-pill">
          {!settingsStatus ? "正在读取" : writable ? settingsStatus.primary_api_key_configured ? "主模型已就绪" : "主模型未配置" : "在线只读"}
        </span>
      </div>
      <div className="settings-layout">
        <div className="settings-status">
          <div>
            <Database size={20} />
            <span>账本数据</span>
            <strong>自动保存</strong>
          </div>
          <div>
            <Key size={20} />
            <span>主接口</span>
            <strong>{settingsStatus?.primary_model || "your-model-name"}</strong>
          </div>
          <div>
            <ShieldCheck size={20} />
            <span>备用接口</span>
            <strong>{backupState}</strong>
          </div>
        </div>
        <div className="settings-form">
          {writable === false && (
            <div className="readonly-notice">
              <ShieldCheck size={20} />
              <div>
                <strong>在线演示仅可查看</strong>
                <span>此演示站点不支持修改 AI 设置，密钥始终隐藏。</span>
              </div>
            </div>
          )}
          <div className="settings-group">
            <span className="form-caption">主模型</span>
            <label className="field-block">
              <span>接口地址</span>
              <input
                value={apiDraft.primary_base_url}
                onChange={(event) => setApiDraft({ ...apiDraft, primary_base_url: event.target.value })}
                placeholder="https://api.openai.com/v1"
                disabled={writable !== true}
              />
            </label>
            <label className="field-block">
              <span>模型名称</span>
              <input
                value={apiDraft.primary_model}
                onChange={(event) => setApiDraft({ ...apiDraft, primary_model: event.target.value })}
                placeholder="gpt-4.1-mini"
                disabled={writable !== true}
              />
            </label>
            {writable === true && <label className="field-block">
              <span>API 密钥</span>
              <input
                type="password"
                value={apiSecretDraft}
                onChange={(event) => setApiSecretDraft(event.target.value)}
                placeholder={settingsStatus?.primary_api_key_configured ? "已配置，留空则保留" : "输入 API 密钥"}
              />
            </label>}
          </div>
          <div className="settings-group">
            <span className="form-caption">备用模型</span>
            <label className="field-block">
              <span>接口地址</span>
              <input
                value={apiDraft.backup_base_url}
                onChange={(event) => setApiDraft({ ...apiDraft, backup_base_url: event.target.value })}
                placeholder="https://api.siliconflow.cn/v1"
                disabled={writable !== true}
              />
            </label>
            <label className="field-block">
              <span>模型名称</span>
              <input
                value={apiDraft.backup_model}
                onChange={(event) => setApiDraft({ ...apiDraft, backup_model: event.target.value })}
                placeholder="deepseek-ai/DeepSeek-V4-Pro"
                disabled={writable !== true}
              />
            </label>
            {writable === true && <label className="field-block">
              <span>API 密钥</span>
              <input
                type="password"
                value={backupSecretDraft}
                onChange={(event) => setBackupSecretDraft(event.target.value)}
                placeholder={settingsStatus?.backup_api_key_configured ? "已配置，留空则保留" : "输入备用 API 密钥"}
              />
            </label>}
          </div>
          <label className="field-block">
            <span>超时时间（秒）</span>
            <input
              type="number"
              min="5"
              max="120"
              value={apiDraft.ai_request_timeout_seconds}
              onChange={(event) => setApiDraft({ ...apiDraft, ai_request_timeout_seconds: event.target.value })}
              placeholder="45"
              disabled={writable !== true}
            />
          </label>
          <div className="settings-actions">
            {writable === true && <button className="primary-button" onClick={saveApiSettings}>{settingsSaved ? "配置已保存" : "保存 AI 配置"}</button>}
            <button className="ghost-button" onClick={testAiProviders} disabled={providerTesting}>
              <ArrowClockwise size={18} />
              {providerTesting ? "正在测试" : "测试模型连接"}
            </button>
          </div>
          <div className="provider-test-list">
            {(providerTests.length ? providerTests : [
              {
                provider: "primary" as const,
                configured: Boolean(settingsStatus?.primary_api_key_configured),
                ok: false,
                base_url: settingsStatus?.primary_base_url || "",
                model: settingsStatus?.primary_model || "",
                latency_ms: 0,
                message: "尚未测试",
              },
              {
                provider: "backup" as const,
                configured: Boolean(settingsStatus?.backup_enabled),
                ok: false,
                base_url: settingsStatus?.backup_base_url || "",
                model: settingsStatus?.backup_model || "",
                latency_ms: 0,
                message: "尚未测试",
              },
            ]).map((result) => (
              <div className={`provider-test-card ${result.ok ? "is-ok" : ""}`} key={result.provider}>
                <div>
                  <span>{result.provider === "primary" ? "主模型" : "备用模型"}</span>
                  <strong>{result.model || "未配置"}</strong>
                </div>
                <em>{result.ok ? `${result.latency_ms}ms` : result.configured ? "未测试" : "未配置"}</em>
                <small>{result.message}</small>
              </div>
            ))}
          </div>
        </div>
        <pre className="env-preview">{
          writable === true
            ? envPreview
            : writable === false
              ? `在线演示配置\n主模型：${settingsStatus?.primary_model || "未配置"}\n备用模型：${settingsStatus?.backup_model || "未启用"}\n配置权限：只读\n密钥：已隐藏`
              : "正在读取 AI 配置..."
        }</pre>
      </div>
    </section>
  );
}

function Metric({ label, value, tone, icon }: { label: string; value: string; tone: string; icon: ReactNode }) {
  return (
    <div className={`metric metric-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      {icon}
    </div>
  );
}

function Insight({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="insight-item">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function providerLabel(provider: ParseResult["provider"] | AdviceResponse["provider"]): string {
  if (provider === "primary") return "主模型";
  if (provider === "backup") return "备用模型";
  if (provider === "fallback") return "基础建议";
  return "本地解析";
}

function parseSourceLabel(result: ParseResult): string {
  if (result.source === "model") return providerLabel(result.provider);
  if (result.source === "error_fallback") return "基础解析";
  return "本地解析";
}

function fieldDisplayName(field: string): string {
  const labels: Record<string, string> = {
    amount_cents: "金额",
    type: "收支类型",
    category: "分类",
    account: "账户",
    occurred_at: "记账时间",
    note: "备注",
  };
  return labels[field] || field;
}

function isDraftFieldUnresolved(field: string, draft: TransactionDraft): boolean {
  if (field === "amount_cents") return draft.amount_cents <= 0;
  if (field === "category") return !draft.category;
  if (field === "account") return !draft.account || draft.account === "未指定";
  if (field === "occurred_at") return !draft.occurred_at;
  if (field === "type") return !draft.type;
  return false;
}

function requiredDraftFields(draft: TransactionDraft): string[] {
  return ["amount_cents", "category", "account", "occurred_at"].filter((field) => isDraftFieldUnresolved(field, draft));
}

function TransactionForm({
  draft,
  setDraft,
  onSave,
  editingId,
  busy,
  saveBlocked,
  onCancelEditing,
}: {
  draft: TransactionDraft;
  setDraft: (draft: TransactionDraft) => void;
  onSave: (draft: TransactionDraft) => void;
  editingId: number | null;
  busy: boolean;
  saveBlocked: boolean;
  onCancelEditing: () => void;
}) {
  const [tagText, setTagText] = useState("");
  const [amountText, setAmountText] = useState(draft.amount_cents ? String(draft.amount_cents / 100) : "");
  const [amountError, setAmountError] = useState("");
  const [occurredAtText, setOccurredAtText] = useState(() => apiIsoToDateTimeLocal(draft.occurred_at));
  const [occurredAtError, setOccurredAtError] = useState("");
  const amountChangedLocally = useRef(false);
  const update = <K extends keyof TransactionDraft>(key: K, value: TransactionDraft[K]) => {
    setDraft({ ...draft, [key]: value });
  };

  useEffect(() => {
    if (amountChangedLocally.current) {
      amountChangedLocally.current = false;
      return;
    }
    setAmountText(draft.amount_cents ? String(draft.amount_cents / 100) : "");
    setAmountError("");
  }, [draft.amount_cents, draft.raw_text, editingId]);

  useEffect(() => {
    try {
      setOccurredAtText(apiIsoToDateTimeLocal(draft.occurred_at));
      setOccurredAtError("");
    } catch (error) {
      setOccurredAtText("");
      setOccurredAtError(error instanceof Error ? error.message : "记账时间格式不正确");
    }
  }, [draft.occurred_at, draft.raw_text, editingId]);

  const updateAmount = (value: string) => {
    setAmountText(value);
    if (!value) {
      setAmountError("请输入金额");
      return;
    }
    if (!/^\d+(?:\.\d{0,2})?$/.test(value)) {
      setAmountError("金额只能填写数字，最多保留两位小数");
      return;
    }
    if (value.endsWith(".")) {
      setAmountError("请补全小数位");
      return;
    }
    try {
      const amountCents = yuanTextToCents(value);
      setAmountError("");
      amountChangedLocally.current = true;
      update("amount_cents", amountCents);
    } catch (error) {
      setAmountError(error instanceof Error ? error.message : "请输入正确金额");
    }
  };

  const updateOccurredAt = (value: string) => {
    setOccurredAtText(value);
    try {
      const apiValue = dateTimeLocalToApiIso(value);
      setOccurredAtError("");
      update("occurred_at", apiValue);
    } catch (error) {
      setOccurredAtError(error instanceof Error ? error.message : "请选择完整的记账时间");
    }
  };

  const submit = () => {
    let amountCents: number;
    try {
      amountCents = yuanTextToCents(amountText);
      setAmountError("");
    } catch (error) {
      setAmountError(error instanceof Error ? error.message : "请输入正确金额");
      return;
    }
    try {
      const occurredAt = dateTimeLocalToApiIso(occurredAtText);
      setOccurredAtError("");
      onSave({ ...draft, amount_cents: amountCents, occurred_at: occurredAt });
    } catch (error) {
      setOccurredAtError(error instanceof Error ? error.message : "请选择完整的记账时间");
    }
  };
  const addTag = () => {
    const tag = tagText.trim().replace(/^#/, "");
    if (!tag) return;
    const nextTags = Array.from(new Set([...(draft.tags || []), tag])).slice(0, 8);
    update("tags", nextTags);
    setTagText("");
  };
  const removeTag = (tag: string) => {
    update("tags", (draft.tags || []).filter((item) => item !== tag));
  };
  return (
    <div className="form-grid">
      <label className="field-block">
        <span>金额</span>
        <input
          inputMode="decimal"
          value={amountText}
          onChange={(event) => updateAmount(event.target.value)}
          placeholder="50.00"
          aria-invalid={Boolean(amountError)}
          aria-describedby={amountError ? "amount-error" : undefined}
        />
        {amountError && <small className="field-error" id="amount-error">{amountError}</small>}
      </label>
      <label className="field-block">
        <span>类型</span>
        <select value={draft.type} onChange={(event) => update("type", event.target.value as TransactionType)}>
          <option value="" disabled>请选择类型</option>
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
      </label>
      <label className="field-block">
        <span>分类</span>
        <select value={draft.category} onChange={(event) => update("category", event.target.value)}>
          <option value="" disabled>请选择分类</option>
          {categories.map((category) => <option key={category}>{category}</option>)}
        </select>
      </label>
      <label className="field-block">
        <span>账户</span>
        <select value={draft.account} onChange={(event) => update("account", event.target.value)}>
          <option value="" disabled>请选择账户</option>
          {accounts.map((account) => <option key={account} disabled={account === "未指定"}>{account}</option>)}
        </select>
      </label>
      <label className="field-block wide">
        <span>记账时间</span>
        <input
          type="datetime-local"
          step="60"
          value={occurredAtText}
          onChange={(event) => updateOccurredAt(event.target.value)}
          aria-invalid={Boolean(occurredAtError)}
          aria-describedby={occurredAtError ? "occurred-at-error" : undefined}
        />
        {occurredAtError && <small className="field-error" id="occurred-at-error">{occurredAtError}</small>}
      </label>
      <label className="field-block wide">
        <span>备注</span>
        <input value={draft.note} onChange={(event) => update("note", event.target.value)} placeholder="例如 疯狂星期四" />
      </label>
      <label className="field-block wide">
        <span>自定义标签</span>
        <div className="tag-editor">
          <Tag size={18} />
          <input
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTag();
              }
            }}
            placeholder="例如 社交、小额高频、宿舍"
          />
          <button onClick={addTag}>添加</button>
        </div>
        {draft.tags?.length > 0 && (
          <div className="tag-chips">
            {draft.tags.map((tag) => (
              <button key={tag} onClick={() => removeTag(tag)}>#{tag}</button>
            ))}
          </div>
        )}
      </label>
      <div className="form-actions wide">
        {editingId && (
          <button className="ghost-button" onClick={onCancelEditing} disabled={busy}>
            <X size={17} />
            取消编辑
          </button>
        )}
        <button
          className="primary-button save-button"
          onClick={submit}
          disabled={busy || saveBlocked || Boolean(amountError) || Boolean(occurredAtError) || !amountText || requiredDraftFields(draft).length > 0}
        >
          {busy ? "正在保存" : editingId ? "保存修改" : "确认入账"}
        </button>
      </div>
    </div>
  );
}

function MiniPie({ title, data }: { title: string; data: Array<{ name: string; amount_cents: number }> }) {
  const total = data.reduce((sum, item) => sum + item.amount_cents, 0);
  return (
    <div className="panel mini-pie">
      <span className="kicker">{title}</span>
      {data.length === 0 ? (
        <p>暂无数据</p>
      ) : (
        <div className="mini-pie-content">
          <div className="pie-chart-wrap">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={data} dataKey="amount_cents" nameKey="name" innerRadius={44} outerRadius={72} paddingAngle={2}>
                  {data.map((entry, index) => <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />)}
                </Pie>
                <Tooltip formatter={(value, name) => [`¥${centsToYuan(Number(value))}`, String(name || "金额")]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="pie-legend">
            {data.slice(0, 5).map((item, index) => (
              <div key={item.name}>
                <i style={{ background: pieColors[index % pieColors.length] }} />
                <span>{item.name}</span>
                <b>{total ? Math.round((item.amount_cents / total) * 100) : 0}%</b>
                <small>¥{centsToYuan(item.amount_cents)}</small>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface TransactionDateGroup {
  date: string;
  items: Transaction[];
  expense_cents: number;
  income_cents: number;
}

function groupTransactionsByDate(items: Transaction[]): TransactionDateGroup[] {
  const groups = new Map<string, TransactionDateGroup>();
  for (const item of items) {
    const date = businessDateKey(item.occurred_at);
    const group = groups.get(date) || { date, items: [], expense_cents: 0, income_cents: 0 };
    group.items.push(item);
    if (item.type === "income") {
      group.income_cents += item.amount_cents;
    } else {
      group.expense_cents += item.amount_cents;
    }
    groups.set(date, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  return `${year}年${Number(monthNumber)}月`;
}

function formatWeekLabel(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const startLabel = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(endDate);
  return `${startLabel} - ${endLabel}`;
}

function formatDay(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00`));
}

function formatChartDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`;
}

function formatChartDateShort(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  return `${Number(match[2])}月${Number(match[3])}日`;
}

export default App;
