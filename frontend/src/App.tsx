import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowClockwise,
  Brain,
  ChartLineUp,
  CheckCircle,
  Coins,
  PencilSimple,
  Plus,
  Receipt,
  ShieldCheck,
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
import type { AdviceResponse, AdviceTone, MonthlyStats, ParseResult, Transaction, TransactionType } from "./types";

const emptyDraft: Omit<Transaction, "id" | "created_at"> = {
  amount_cents: 0,
  type: "expense",
  category: "餐饮",
  account: "微信",
  occurred_at: new Date().toISOString(),
  note: "",
  raw_text: "",
};

const categories = ["餐饮", "交通", "娱乐", "学习", "购物", "住房", "医疗", "其他", "兼职"];
const accounts = ["微信", "支付宝", "银行卡", "现金"];
const pieColors = ["#62d7bd", "#8ca3ad", "#c4ccd1", "#76918f", "#d96f6a", "#aab5bd"];

function App() {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const budgetStatus = useMemo(() => {
    if (!stats?.budget_limit_cents) return "未设置";
    if (stats.budget_usage_ratio >= 1) return "已超支";
    if (stats.budget_usage_ratio >= 0.8) return "接近上限";
    return "健康";
  }, [stats]);

  async function refresh() {
    setError("");
    try {
      const [nextStats, nextTransactions, nextAdvice] = await Promise.all([
        api.monthlyStats(month),
        api.listTransactions(month),
        api.monthlyAdvice(month, tone),
      ]);
      setStats(nextStats);
      setTransactions(nextTransactions);
      setAdvice(nextAdvice);
      if (nextStats.budget_limit_cents) {
        setBudgetYuan(String(nextStats.budget_limit_cents / 100));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }

  useEffect(() => {
    refresh();
  }, [month, tone]);

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
    });
  }

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

  return (
    <main className="min-h-[100dvh] bg-[var(--page)] text-[var(--ink)]">
      <div className="app-shell">
        <aside className="side-rail">
          <div className="brand-mark">
            <Wallet size={26} weight="duotone" />
          </div>
          <nav className="rail-nav" aria-label="主导航">
            <a href="#dashboard" className="rail-item active"><ChartLineUp size={20} />总览</a>
            <a href="#quick" className="rail-item"><Brain size={20} />AI 快记</a>
            <a href="#transactions" className="rail-item"><Receipt size={20} />流水</a>
            <a href="#budget" className="rail-item"><ShieldCheck size={20} />预算</a>
          </nav>
          <div className="rail-note">
            <span>SQLite</span>
            <strong>整数分存储</strong>
          </div>
        </aside>

        <section className="workspace">
          <header className="topbar">
            <div>
              <p className="caption">Pocket Ledger AI</p>
              <h1>把一句消费记录变成可解释的财务数据</h1>
            </div>
            <div className="top-actions">
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
              <button className="icon-button" onClick={refresh} aria-label="刷新">
                <ArrowClockwise size={18} />
              </button>
            </div>
          </header>

          {error && <div className="error-strip">{error}</div>}

          <section id="dashboard" className="dashboard-grid">
            <Metric label="本月支出" value={`¥${centsToYuan(displayStats.expense_cents)}`} tone="expense" icon={<Coins size={22} />} />
            <Metric label="本月收入" value={`¥${centsToYuan(displayStats.income_cents)}`} tone="income" icon={<Wallet size={22} />} />
            <Metric label="预算剩余" value={`¥${centsToYuan(displayStats.budget_remaining_cents)}`} tone={displayStats.budget_remaining_cents < 0 ? "danger" : "neutral"} icon={<ShieldCheck size={22} />} />
            <div className="advice-panel">
              <div className="panel-title">
                <Brain size={20} />
                <span>AI 财务点评</span>
              </div>
              <p>{advice?.advice || "正在生成建议..."}</p>
              <div className="segmented">
                <button className={tone === "sharp" ? "selected" : ""} onClick={() => setTone("sharp")}>直接</button>
                <button className={tone === "warm" ? "selected" : ""} onClick={() => setTone("warm")}>温和</button>
              </div>
            </div>
          </section>

          <section className="content-grid">
            <div id="quick" className="panel quick-panel">
              <div className="section-heading">
                <div>
                  <p className="caption">Quick Entry</p>
                  <h2>一句话记账</h2>
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
                <button className="ghost-button" onClick={() => setDraft({ ...emptyDraft, occurred_at: new Date().toISOString() })}>
                  <Plus size={18} />
                  手动录入
                </button>
              </div>
              {parsed && (
                <div className="parse-card">
                  <CheckCircle size={20} weight="fill" />
                  <div>
                    <strong>解析来源：{parsed.source === "model" ? "模型" : "本地兜底"}</strong>
                    <span>置信度 {(parsed.confidence * 100).toFixed(0)}%，请确认后入账</span>
                  </div>
                </div>
              )}
              <TransactionForm draft={draft} setDraft={setDraft} onSave={saveDraft} editingId={editingId} />
            </div>

            <div className="panel chart-panel">
              <div className="section-heading">
                <div>
                  <p className="caption">Analytics</p>
                  <h2>消费趋势</h2>
                </div>
              </div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={displayStats.daily_trend}>
                    <defs>
                      <linearGradient id="expenseGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#62d7bd" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#62d7bd" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#d8dee2" strokeDasharray="3 6" vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#66737b", fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: "#66737b", fontSize: 11 }} tickFormatter={(value) => `${Number(value) / 100}`} />
                    <Tooltip formatter={(value) => `¥${centsToYuan(Number(value))}`} />
                    <Area type="monotone" dataKey="expense_cents" stroke="#219c85" fill="url(#expenseGradient)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="split-charts">
                <MiniPie title="分类占比" data={displayStats.category_breakdown} />
                <MiniPie title="账户分布" data={displayStats.account_breakdown} />
              </div>
            </div>
          </section>

          <section className="lower-grid">
            <div id="transactions" className="panel">
              <div className="section-heading">
                <div>
                  <p className="caption">Transactions</p>
                  <h2>流水列表</h2>
                </div>
                <span className="status-pill">{transactions.length} 笔</span>
              </div>
              <div className="transaction-list">
                {transactions.length === 0 ? (
                  <div className="empty-state">这个月还没有账单，先记一笔。</div>
                ) : (
                  transactions.map((item) => (
                    <div className="transaction-row" key={item.id}>
                      <div>
                        <strong>{item.note || item.category}</strong>
                        <span>{item.category} / {item.account} / {new Date(item.occurred_at).toLocaleDateString("zh-CN")}</span>
                      </div>
                      <div className="row-actions">
                        <b className={item.type === "income" ? "positive" : ""}>{item.type === "income" ? "+" : "-"}¥{centsToYuan(item.amount_cents)}</b>
                        <button onClick={() => editTransaction(item)} aria-label="编辑"><PencilSimple size={17} /></button>
                        <button onClick={() => removeTransaction(item.id)} aria-label="删除"><Trash size={17} /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div id="budget" className="panel budget-panel">
              <div className="section-heading">
                <div>
                  <p className="caption">Budget</p>
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
            </div>
          </section>
        </section>
      </div>
    </main>
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
  const amountYuan = draft.amount_cents ? String(draft.amount_cents / 100) : "";
  const update = <K extends keyof Omit<Transaction, "id" | "created_at">>(key: K, value: Omit<Transaction, "id" | "created_at">[K]) => {
    setDraft({ ...draft, [key]: value });
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
      <button className="primary-button save-button" onClick={onSave} disabled={!draft.amount_cents || !draft.category || !draft.account}>
        {editingId ? "保存修改" : "确认入账"}
      </button>
    </div>
  );
}

function MiniPie({ title, data }: { title: string; data: Array<{ name: string; amount_cents: number }> }) {
  return (
    <div className="mini-pie">
      <span>{title}</span>
      {data.length === 0 ? (
        <p>暂无数据</p>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <PieChart>
            <Pie data={data} dataKey="amount_cents" nameKey="name" innerRadius={36} outerRadius={58} paddingAngle={2}>
              {data.map((entry, index) => <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />)}
            </Pie>
            <Tooltip formatter={(value) => `¥${centsToYuan(Number(value))}`} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export default App;
