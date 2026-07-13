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
import { centsToYuan, monthKey, yuanTextToCents } from "./money";
import type { AdviceResponse, AdviceSnapshot, AdviceTone, AiProviderTestResult, AiSettingsPayload, MonthlyStats, ParseResult, SettingsStatus, Transaction, TransactionType } from "./types";

type ViewKey = "overview" | "quick" | "transactions" | "analytics" | "budget" | "settings";
type DataStatus = "loading" | "waking" | "ready" | "error";
type AdviceBusyState = "idle" | "cache" | "generate";
type TransactionDraft = Omit<Transaction, "id" | "created_at">;

const emptyAdviceSnapshot: AdviceSnapshot = {
  status: "missing",
  advice: null,
  generated_at: null,
};

const emptyDraft: TransactionDraft = {
  amount_cents: 0,
  type: "expense",
  category: "餐饮",
  account: "微信",
  occurred_at: new Date().toISOString(),
  note: "",
  raw_text: "",
  tags: [],
};

const categories = ["餐饮", "饮品", "交通", "娱乐", "学习", "购物", "住房", "医疗", "兼职", "收入", "其他"];
const accounts = ["微信", "支付宝", "银行卡", "现金", "未指定"];
const pieColors = ["#276f79", "#a8844f", "#735a73", "#53697f", "#08776d", "#aa6f58"];

const navItems: Array<{ key: ViewKey; label: string; helper: string; icon: ReactNode }> = [
  { key: "overview", label: "总览", helper: "本月状态", icon: <ChartLineUp size={20} /> },
  { key: "quick", label: "AI 快记", helper: "一句话入账", icon: <Brain size={20} /> },
  { key: "transactions", label: "流水", helper: "日期分组", icon: <Receipt size={20} /> },
  { key: "analytics", label: "分析", helper: "趋势和占比", icon: <ChartPieSlice size={20} /> },
  { key: "budget", label: "预算", helper: "风险线", icon: <ShieldCheck size={20} /> },
  { key: "settings", label: "设置", helper: "API 和本地", icon: <GearSix size={20} /> },
];

const pageCopy: Record<ViewKey, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: "Command center",
    title: "本月财务工作台",
    description: "先看预算线和现金流，再进入快记、流水或分析页面。",
  },
  quick: {
    eyebrow: "Quick entry",
    title: "一句话记账",
    description: "AI 只生成待确认草稿，手动修改后再写入 SQLite。",
  },
  transactions: {
    eyebrow: "Ledger",
    title: "日期分组流水",
    description: "按天复盘消费场景，保留标签、账户和备注线索。",
  },
  analytics: {
    eyebrow: "Analytics",
    title: "图表与文字结论",
    description: "每个图表旁边都有可直接阅读的金额、占比和趋势解释。",
  },
  budget: {
    eyebrow: "Budget",
    title: "预算风险线",
    description: "设置月度预算，查看使用率和 AI 财务建议。",
  },
  settings: {
    eyebrow: "Settings",
    title: "接口与本地配置",
    description: "查看主备接口状态；本地可保存配置，线上演示由服务器托管密钥。",
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
  const [stats, setStats] = useState<MonthlyStats | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [adviceSnapshot, setAdviceSnapshot] = useState<AdviceSnapshot>(emptyAdviceSnapshot);
  const [adviceBusy, setAdviceBusy] = useState<AdviceBusyState>("idle");
  const [adviceError, setAdviceError] = useState("");
  const [tone, setTone] = useState<AdviceTone>("sharp");
  const [quickText, setQuickText] = useState("今天中午和室友吃疯狂星期四花了 50 块，微信付的");
  const [draft, setDraft] = useState<TransactionDraft>(emptyDraft);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
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
  const groupedTransactions = useMemo(() => groupTransactionsByDate(transactions), [transactions]);
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
    setError("");
    if (resetData) {
      setStats(null);
      setTransactions([]);
    }
    setDataStatus(resetData || !stats ? "loading" : "ready");
    const wakeTimer = window.setTimeout(() => {
      setDataStatus((current) => current === "loading" ? "waking" : current);
    }, 1200);
    try {
      const [nextStats, nextTransactions] = await Promise.all([
        api.monthlyStats(month),
        api.listTransactions(month),
      ]);
      setStats(nextStats);
      setTransactions(nextTransactions);
      if (nextStats.budget_limit_cents) {
        setBudgetYuan(String(nextStats.budget_limit_cents / 100));
      }
      setDataStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
      setDataStatus("error");
    } finally {
      window.clearTimeout(wakeTimer);
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

  async function loadSettings() {
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
    } catch {
      setSettingsStatus(null);
    }
  }

  useEffect(() => {
    refresh(true);
  }, [month]);

  useEffect(() => {
    if (activeView === "overview" || activeView === "budget") loadCachedAdvice();
  }, [activeView, month, tone]);

  useEffect(() => {
    loadSettings();
  }, []);

  async function parseQuickEntry() {
    setLoading(true);
    setError("");
    try {
      const result = await api.parseTransaction(quickText);
      setParsed(result);
      setDraft({
        amount_cents: result.amount_cents,
        type: result.type,
        category: result.category,
        account: result.account,
        occurred_at: result.occurred_at,
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
    setLoading(true);
    setError("");
    const wasEditing = Boolean(editingId);
    try {
      if (editingId) {
        await api.updateTransaction(editingId, nextDraft);
      } else {
        await api.createTransaction(nextDraft);
      }
      setEditingId(null);
      setParsed(null);
      setDraft({ ...emptyDraft, occurred_at: new Date().toISOString() });
      await refresh();
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
    setParsed(null);
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
      refresh();
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
              <span>AI Ledger</span>
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
          <div className="brand-zone">
            <div className="brand-mark">
              <Wallet size={25} weight="duotone" />
            </div>
            <div>
              <strong>口袋记账</strong>
              <span>AI Ledger</span>
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
            <span>SQLite</span>
            <strong>整数分存储</strong>
            <small>{settingsStatus?.api_key_configured ? "模型接口已配置" : "本地规则可兜底"}</small>
          </div>
        </aside>

        <section className="workspace">
          <header className="topbar">
            <div className="page-title">
              <span>{page.eyebrow}</span>
              <h1>{page.title}</h1>
              <p>{page.description}</p>
            </div>
            <div className="top-actions">
              <input aria-label="选择统计月份" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
              <button
                className="icon-button"
                onClick={() => {
                  refresh();
                  if (activeView === "overview" || activeView === "budget") loadCachedAdvice(true);
                }}
                aria-label="刷新"
              >
                <ArrowClockwise size={18} />
              </button>
            </div>
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
                onOpenQuick={() => setActiveView("quick")}
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
                parseQuickEntry={parseQuickEntry}
                saveDraft={saveDraft}
              />
              )}

              {activeView === "transactions" && (
              <TransactionsPage
                transactions={transactions}
                groupedTransactions={groupedTransactions}
                editTransaction={editTransaction}
                requestDelete={setPendingDelete}
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
          <h2>暂时没有连接到后端</h2>
          <p>免费实例可能仍在唤醒，也可以先进入 AI 快记填写草稿，稍后再保存。</p>
        </div>
        <button className="primary-button" onClick={onRetry}>重新连接</button>
      </section>
    );
  }
  return (
    <section className="panel loading-state">
      <div className="loading-copy">
        <span className="loading-pulse" />
        <div>
          <h2>{status === "waking" ? "后端正在唤醒" : "正在读取本月账本"}</h2>
          <p>{status === "waking" ? "Render 免费实例首次访问可能需要约一分钟。" : "正在加载流水、预算和统计。"}</p>
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
          <button className="ghost-button" onClick={onCancel} disabled={deleting}>取消</button>
          <button className="danger-button" onClick={() => onConfirm(transaction.id)} disabled={deleting}>
            {deleting ? "删除中" : "确认删除"}
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
        : settingsStatus?.api_key_configured ? "点评待生成" : "本地规则待生成";
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
            <p>{budgetStatus === "健康" ? "预算仍在安全范围内，继续保持记录频率。" : `预算状态: ${budgetStatus}`}</p>
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
          <StatusLine label="预算线" value={budgetStatus} />
          <StatusLine label="AI 接口" value={aiRuntimeLabel} />
          <StatusLine label="活跃记账日" value={`${activeDays} 天`} />
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
  parseQuickEntry,
  saveDraft,
}: {
  quickText: string;
  setQuickText: (value: string) => void;
  parsed: ParseResult | null;
  draft: TransactionDraft;
  setDraft: (draft: TransactionDraft) => void;
  loading: boolean;
  editingId: number | null;
  parseQuickEntry: () => void;
  saveDraft: (draft: TransactionDraft) => void;
}) {
  return (
    <div className="quick-layout">
      <section className="panel quick-command">
        <div className="section-heading">
          <div>
            <span className="kicker">自然语言输入</span>
            <h2>先说人话，再确认字段</h2>
          </div>
          <span className="status-pill">{parsed ? "待确认" : "AI 解析"}</span>
        </div>
        <textarea
          value={quickText}
          onChange={(event) => setQuickText(event.target.value)}
          placeholder="例如：今天中午和室友吃疯狂星期四花了 50 块，微信付的"
        />
        <div className="button-row">
          <button className="primary-button" onClick={parseQuickEntry} disabled={loading}>
            <Brain size={18} />
            {loading ? "处理中" : "解析这句话"}
          </button>
        </div>
        {parsed && (
          <div className="parse-card">
            <CheckCircle size={20} weight="fill" />
            <div>
              <strong>解析来源: {parsed.source === "model" ? providerLabel(parsed.provider) : "本地规则兜底"}</strong>
              <span>
                置信度 {(parsed.confidence * 100).toFixed(0)}%，
                {parsed.missing_fields.length ? `缺失 ${parsed.missing_fields.join(", ")}` : "字段完整"}，确认后入账
              </span>
            </div>
          </div>
        )}
      </section>
      <section className="panel form-panel">
        <div className="section-heading">
          <div>
            <span className="kicker">结构化账单</span>
            <h2>{editingId ? "编辑流水" : "确认入账"}</h2>
          </div>
        </div>
        <TransactionForm draft={draft} setDraft={setDraft} onSave={saveDraft} editingId={editingId} />
      </section>
    </div>
  );
}

function TransactionsPage({
  transactions,
  groupedTransactions,
  editTransaction,
  requestDelete,
}: {
  transactions: Transaction[];
  groupedTransactions: TransactionDateGroup[];
  editTransaction: (item: Transaction) => void;
  requestDelete: (item: Transaction) => void;
}) {
  return (
    <section className="panel ledger-panel">
      <div className="section-heading">
        <div>
          <span className="kicker">Ledger</span>
          <h2>流水列表</h2>
        </div>
        <span className="status-pill">{transactions.length} 笔</span>
      </div>
      <div className="transaction-list">
        {transactions.length === 0 ? (
          <div className="empty-state">这个月还没有账单，先记一笔。</div>
        ) : (
          groupedTransactions.map((group) => (
            <section className="date-group" key={group.date}>
              <div className="date-header">
                <div>
                  <strong>{formatDay(group.date)}</strong>
                  <span>{group.items.length} 笔 / 支出 ¥{centsToYuan(group.expense_cents)} / 收入 ¥{centsToYuan(group.income_cents)}</span>
                </div>
                <b className={group.income_cents - group.expense_cents >= 0 ? "positive" : "negative"}>
                  {group.income_cents - group.expense_cents >= 0 ? "+" : "-"}¥{centsToYuan(Math.abs(group.income_cents - group.expense_cents))}
                </b>
              </div>
              {group.items.map((item) => (
                <div className="transaction-row" key={item.id}>
                  <div>
                    <strong>{item.note || item.category}</strong>
                    <span>{item.category} / {item.account} / {new Date(item.occurred_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
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
      </div>
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
            <span className="kicker">Trend</span>
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
              <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#65717a", fontSize: 11 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "#65717a", fontSize: 11 }} tickFormatter={(value) => `${Number(value) / 100}`} />
              <Tooltip formatter={(value) => `¥${centsToYuan(Number(value))}`} />
              <Area type="monotone" dataKey="expense_cents" stroke="#276f79" fill="url(#expenseGradient)" strokeWidth={2.5} />
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
            <span className="kicker">Risk line</span>
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
      ? "读取缓存"
      : snapshot.status === "stale"
        ? "待更新"
        : advice ? providerLabel(advice.provider) : "尚未生成";
  const headline = advice?.headline || advice?.advice || (isGenerating ? "正在生成本月点评" : "本月还没有 AI 点评");
  const detail = advice?.detail || (
    isGenerating
      ? "AI 正在根据已确认的账单和预算生成结论，生成成功后会保存到 SQLite。"
      : "点击生成后才会调用模型；如果本月数据没有变化，下次会直接展示已保存的结果。"
  );
  let cacheMessage = "不会自动调用模型";
  if (busy === "cache") cacheMessage = "正在读取 SQLite 中的已保存点评";
  else if (isGenerating) cacheMessage = "本次由用户手动触发，生成后自动缓存";
  else if (snapshot.status === "stale") cacheMessage = "账单或预算已变化，当前点评基于上一版数据";
  else if (advice?.source === "error_fallback") cacheMessage = "模型调用失败，本次兜底结果未写入缓存";
  else if (snapshot.generated_at) cacheMessage = `数据未变化，直接读取 ${formatAdviceTime(snapshot.generated_at)} 的结果`;

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
      <Database size={16} />
      <span>{cacheMessage}</span>
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
          <span className="kicker">Runtime</span>
          <h2>API 运行配置</h2>
        </div>
        <span className="status-pill">
          {!settingsStatus ? "状态未连接" : writable ? settingsStatus.primary_api_key_configured ? "主 Key 已配置" : "主 Key 未配置" : "线上只读"}
        </span>
      </div>
      <div className="settings-layout">
        <div className="settings-status">
          <div>
            <Database size={20} />
            <span>SQLite 文件</span>
            <strong>{settingsStatus?.database_file || "pocket_ledger.db"}</strong>
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
                <strong>公开演示已锁定配置写入</strong>
                <span>模型和 Key 由 Render 环境变量管理，浏览器只显示非敏感状态。</span>
              </div>
            </div>
          )}
          <div className="settings-group">
            <span className="form-caption">Primary</span>
            <label className="field-block">
              <span>主 Base URL</span>
              <input
                value={apiDraft.primary_base_url}
                onChange={(event) => setApiDraft({ ...apiDraft, primary_base_url: event.target.value })}
                placeholder="https://api.openai.com/v1"
                disabled={writable !== true}
              />
            </label>
            <label className="field-block">
              <span>主 Model</span>
              <input
                value={apiDraft.primary_model}
                onChange={(event) => setApiDraft({ ...apiDraft, primary_model: event.target.value })}
                placeholder="gpt-4.1-mini"
                disabled={writable !== true}
              />
            </label>
            {writable === true && <label className="field-block">
              <span>主 API Key</span>
              <input
                type="password"
                value={apiSecretDraft}
                onChange={(event) => setApiSecretDraft(event.target.value)}
                placeholder={settingsStatus?.primary_api_key_configured ? "已配置，留空则保留" : "输入主 Key"}
              />
            </label>}
          </div>
          <div className="settings-group">
            <span className="form-caption">Backup</span>
            <label className="field-block">
              <span>备用 Base URL</span>
              <input
                value={apiDraft.backup_base_url}
                onChange={(event) => setApiDraft({ ...apiDraft, backup_base_url: event.target.value })}
                placeholder="https://api.siliconflow.cn/v1"
                disabled={writable !== true}
              />
            </label>
            <label className="field-block">
              <span>备用 Model</span>
              <input
                value={apiDraft.backup_model}
                onChange={(event) => setApiDraft({ ...apiDraft, backup_model: event.target.value })}
                placeholder="deepseek-ai/DeepSeek-V4-Pro"
                disabled={writable !== true}
              />
            </label>
            {writable === true && <label className="field-block">
              <span>备用 API Key</span>
              <input
                type="password"
                value={backupSecretDraft}
                onChange={(event) => setBackupSecretDraft(event.target.value)}
                placeholder={settingsStatus?.backup_api_key_configured ? "已配置，留空则保留" : "输入备用 Key"}
              />
            </label>}
          </div>
          <label className="field-block">
            <span>超时秒数</span>
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
            {writable === true && <button className="primary-button" onClick={saveApiSettings}>{settingsSaved ? "已保存到后端" : "保存真实配置"}</button>}
            <button className="ghost-button" onClick={testAiProviders} disabled={providerTesting}>
              <ArrowClockwise size={18} />
              {providerTesting ? "测试中" : "测试主备接口"}
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
                <em>{result.ok ? `${result.latency_ms}ms` : result.configured ? "待确认" : "未配置"}</em>
                <small>{result.message}</small>
              </div>
            ))}
          </div>
        </div>
        <pre className="env-preview">{
          writable === true
            ? envPreview
            : writable === false
              ? "线上演示模式\nAI 配置来源: Render Environment Variables\n浏览器写入: disabled\n真实 Key: never exposed"
              : "正在读取后端设置状态..."
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
  if (provider === "fallback") return "失败兜底";
  return "本地规则";
}

function TransactionForm({
  draft,
  setDraft,
  onSave,
  editingId,
}: {
  draft: TransactionDraft;
  setDraft: (draft: TransactionDraft) => void;
  onSave: (draft: TransactionDraft) => void;
  editingId: number | null;
}) {
  const [tagText, setTagText] = useState("");
  const [amountText, setAmountText] = useState(draft.amount_cents ? String(draft.amount_cents / 100) : "");
  const [amountError, setAmountError] = useState("");
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
    setAmountError("");
    amountChangedLocally.current = true;
    update("amount_cents", yuanTextToCents(value));
  };

  const submit = () => {
    try {
      const amountCents = yuanTextToCents(amountText);
      setAmountError("");
      onSave({ ...draft, amount_cents: amountCents });
    } catch (error) {
      setAmountError(error instanceof Error ? error.message : "请输入正确金额");
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
          <option value="expense">支出</option>
          <option value="income">收入</option>
        </select>
      </label>
      <label className="field-block">
        <span>分类</span>
        <select value={draft.category} onChange={(event) => update("category", event.target.value)}>
          {categories.map((category) => <option key={category}>{category}</option>)}
        </select>
      </label>
      <label className="field-block">
        <span>账户</span>
        <select value={draft.account} onChange={(event) => update("account", event.target.value)}>
          {accounts.map((account) => <option key={account} disabled={account === "未指定"}>{account}</option>)}
        </select>
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
      <button
        className="primary-button save-button"
        onClick={submit}
        disabled={Boolean(amountError) || !amountText || !draft.category || !draft.account || draft.account === "未指定"}
      >
        {editingId ? "保存修改" : "确认入账"}
      </button>
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
                <Tooltip formatter={(value) => `¥${centsToYuan(Number(value))}`} />
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
    const date = item.occurred_at.slice(0, 10);
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

function formatDay(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00`));
}

export default App;
