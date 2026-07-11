import { useEffect, useMemo, useState } from "react";
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
import type { AdviceResponse, AdviceTone, AiProviderTestResult, AiSettingsPayload, MonthlyStats, ParseResult, SettingsStatus, Transaction, TransactionType } from "./types";

type ViewKey = "overview" | "quick" | "transactions" | "analytics" | "budget" | "settings";

const emptyDraft: Omit<Transaction, "id" | "created_at"> = {
  amount_cents: 0,
  type: "expense",
  category: "餐饮",
  account: "微信",
  occurred_at: new Date().toISOString(),
  note: "",
  raw_text: "",
  tags: [],
};

const categories = ["餐饮", "交通", "娱乐", "学习", "购物", "住房", "医疗", "其他", "兼职"];
const accounts = ["微信", "支付宝", "银行卡", "现金"];
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
    description: "设置主接口、备用接口和超时时间，保存后后端立即按新配置调用模型。",
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
  const [advice, setAdvice] = useState<AdviceResponse | null>(null);
  const [tone, setTone] = useState<AdviceTone>("sharp");
  const [quickText, setQuickText] = useState("今天中午和室友吃疯狂星期四花了 50 块，微信付的");
  const [draft, setDraft] = useState<Omit<Transaction, "id" | "created_at">>(emptyDraft);
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
  const [error, setError] = useState("");

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

  async function refresh() {
    setError("");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  async function refreshAdvice() {
    setAdvice(null);
    try {
      const nextAdvice = await api.monthlyAdvice(month, tone);
      setAdvice(nextAdvice);
    } catch {
      setAdvice({
        tone,
        advice: "AI 建议暂时不可用",
        headline: "AI 建议暂时不可用",
        detail: "本月基础数据已经加载，但建议接口没有返回。可以先查看预算、分类和流水，稍后再重新尝试生成分析。",
        action_items: ["检查后端状态", "确认 API 配置"],
        source: "error_fallback",
        provider: "fallback",
      });
    }
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
    refresh();
  }, [month]);

  useEffect(() => {
    refreshAdvice();
  }, [month, tone]);

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

  async function saveDraft() {
    setLoading(true);
    setError("");
    const wasEditing = Boolean(editingId);
    try {
      if (editingId) {
        await api.updateTransaction(editingId, draft);
      } else {
        await api.createTransaction(draft);
      }
      setEditingId(null);
      setParsed(null);
      setDraft({ ...emptyDraft, occurred_at: new Date().toISOString() });
      await refresh();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "预算保存失败");
    }
  }

  async function removeTransaction(id: number) {
    await api.deleteTransaction(id);
    await refresh();
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

  return (
    <main className="app-root">
      <div className="app-shell">
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
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
              <button className="icon-button" onClick={refresh} aria-label="刷新">
                <ArrowClockwise size={18} />
              </button>
            </div>
          </header>

          {error && <div className="error-strip">{error}</div>}

          <section className="page-frame" aria-live="polite">
            {activeView === "overview" && (
              <OverviewPage
                displayStats={displayStats}
                budgetStatus={budgetStatus}
                transactionCount={transactions.length}
                advice={advice}
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
                removeTransaction={removeTransaction}
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
                advice={advice}
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
          </section>
        </section>
      </div>
    </main>
  );
}

function OverviewPage({
  displayStats,
  budgetStatus,
  transactionCount,
  advice,
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
  advice: AdviceResponse | null;
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
  return (
    <div className="overview-page page-stack">
      <section className="command-board">
        <div className="board-main">
          <div className="board-toolbar" aria-label="本月总览控制条">
            <span>预算 {budgetPercent}%</span>
            <span>{transactionCount} 笔流水</span>
            <span>{settingsStatus?.api_key_configured ? "模型接入" : "本地兜底"}</span>
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
          <StatusLine label="AI 接口" value={settingsStatus?.api_key_configured ? "模型已接入" : "本地规则兜底"} />
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
          <div className="panel-title">
            <Brain size={20} />
            <span>AI 财务点评</span>
          </div>
          <div className="advice-copy">
            <strong>{advice?.headline || advice?.advice || "正在生成建议..."}</strong>
            <p>{advice?.detail || "AI 正在根据本月收入、支出、预算、分类和账户分布生成详细分析。"}</p>
          </div>
          <div className="segmented">
            <button className={tone === "sharp" ? "selected" : ""} onClick={() => setTone("sharp")}>直接</button>
            <button className={tone === "warm" ? "selected" : ""} onClick={() => setTone("warm")}>温和</button>
          </div>
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
  draft: Omit<Transaction, "id" | "created_at">;
  setDraft: (draft: Omit<Transaction, "id" | "created_at">) => void;
  loading: boolean;
  editingId: number | null;
  parseQuickEntry: () => void;
  saveDraft: () => void;
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
  removeTransaction,
}: {
  transactions: Transaction[];
  groupedTransactions: TransactionDateGroup[];
  editTransaction: (item: Transaction) => void;
  removeTransaction: (id: number) => void;
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
                    <button onClick={() => editTransaction(item)} aria-label="编辑"><PencilSimple size={17} /></button>
                    <button onClick={() => removeTransaction(item.id)} aria-label="删除"><Trash size={17} /></button>
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
  advice,
  tone,
  setTone,
}: {
  displayStats: MonthlyStats;
  budgetStatus: string;
  budgetYuan: string;
  setBudgetYuan: (value: string) => void;
  saveBudget: () => void;
  advice: AdviceResponse | null;
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
        <div className="panel-title">
          <Brain size={20} />
          <span>预算建议</span>
        </div>
        <div className="advice-copy">
          <strong>{advice?.headline || advice?.advice || "正在生成建议..."}</strong>
          <p>{advice?.detail || "AI 正在结合预算使用率、最高分类、主要账户和日均支出生成建议。"}</p>
        </div>
        <div className="action-list">
          {(advice?.action_items?.length ? advice.action_items : ["等待分析结果", "先保持记账"]).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="segmented">
          <button className={tone === "sharp" ? "selected" : ""} onClick={() => setTone("sharp")}>直接</button>
          <button className={tone === "warm" ? "selected" : ""} onClick={() => setTone("warm")}>温和</button>
        </div>
      </section>
    </div>
  );
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
  return (
    <section className="panel settings-panel">
      <div className="section-heading">
        <div>
          <span className="kicker">Runtime</span>
          <h2>真实 API 配置</h2>
        </div>
        <span className="status-pill">{settingsStatus?.primary_api_key_configured ? "主 Key 已配置" : "主 Key 未配置"}</span>
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
          <div className="settings-group">
            <span className="form-caption">Primary</span>
            <label className="field-block">
              <span>主 Base URL</span>
              <input
                value={apiDraft.primary_base_url}
                onChange={(event) => setApiDraft({ ...apiDraft, primary_base_url: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="field-block">
              <span>主 Model</span>
              <input
                value={apiDraft.primary_model}
                onChange={(event) => setApiDraft({ ...apiDraft, primary_model: event.target.value })}
                placeholder="gpt-4.1-mini"
              />
            </label>
            <label className="field-block">
              <span>主 API Key</span>
              <input
                type="password"
                value={apiSecretDraft}
                onChange={(event) => setApiSecretDraft(event.target.value)}
                placeholder={settingsStatus?.primary_api_key_configured ? "已配置，留空则保留" : "输入主 Key"}
              />
            </label>
          </div>
          <div className="settings-group">
            <span className="form-caption">Backup</span>
            <label className="field-block">
              <span>备用 Base URL</span>
              <input
                value={apiDraft.backup_base_url}
                onChange={(event) => setApiDraft({ ...apiDraft, backup_base_url: event.target.value })}
                placeholder="https://api.siliconflow.cn/v1"
              />
            </label>
            <label className="field-block">
              <span>备用 Model</span>
              <input
                value={apiDraft.backup_model}
                onChange={(event) => setApiDraft({ ...apiDraft, backup_model: event.target.value })}
                placeholder="deepseek-ai/DeepSeek-V4-Pro"
              />
            </label>
            <label className="field-block">
              <span>备用 API Key</span>
              <input
                type="password"
                value={backupSecretDraft}
                onChange={(event) => setBackupSecretDraft(event.target.value)}
                placeholder={settingsStatus?.backup_api_key_configured ? "已配置，留空则保留" : "输入备用 Key"}
              />
            </label>
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
            />
          </label>
          <div className="settings-actions">
            <button className="primary-button" onClick={saveApiSettings}>{settingsSaved ? "已保存到后端" : "保存真实配置"}</button>
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
        <pre className="env-preview">{envPreview}</pre>
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
  draft: Omit<Transaction, "id" | "created_at">;
  setDraft: (draft: Omit<Transaction, "id" | "created_at">) => void;
  onSave: () => void;
  editingId: number | null;
}) {
  const [tagText, setTagText] = useState("");
  const amountYuan = draft.amount_cents ? String(draft.amount_cents / 100) : "";
  const update = <K extends keyof Omit<Transaction, "id" | "created_at">>(key: K, value: Omit<Transaction, "id" | "created_at">[K]) => {
    setDraft({ ...draft, [key]: value });
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
          value={amountYuan}
          onChange={(event) => {
            try {
              update("amount_cents", yuanTextToCents(event.target.value));
            } catch {
              update("amount_cents", 0);
            }
          }}
          placeholder="50.00"
        />
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
          {accounts.map((account) => <option key={account}>{account}</option>)}
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
      <button className="primary-button save-button" onClick={onSave} disabled={!draft.amount_cents || !draft.category || !draft.account}>
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
