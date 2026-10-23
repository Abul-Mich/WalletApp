import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../AuthContext";
import { isAdmin } from "../lib/roles";
import { loadAccounts, latestLbpRate, bal, spendRollup, INCOME_TYPES } from "../lib/wallets";
import { formatUsd, formatShortDate, formatDate } from "../lib/format";
import TransactionRow from "./TransactionRow";
import IncomeRow from "./IncomeRow";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import "../styles/statistics.css";
import "../styles/statistics-extra.css";
import { makeColorFor } from "../lib/categoryColors";

// ---------- Beirut calendar helpers (the family's day boundaries) ----------
const TZ = "Asia/Beirut";
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const dayKey = (iso) => keyFmt.format(new Date(iso));
const todayKey = () => keyFmt.format(new Date());
const addDays = (key, n) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function offsetMin(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}
// The instant a Beirut calendar day starts.
function midnight(key) {
  const guess = new Date(`${key}T00:00:00Z`);
  let t = guess.getTime() - offsetMin(guess) * 60000;
  t = guess.getTime() - offsetMin(new Date(t)) * 60000;
  return new Date(t);
}

const PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom range" },
];

// Returns { start, end (exclusive), error } for a preset.
function rangeFor(preset, customStart, customEnd) {
  const today = todayKey();
  if (preset === "today") return { start: midnight(today), end: midnight(addDays(today, 1)) };
  if (preset === "yesterday") return { start: midnight(addDays(today, -1)), end: midnight(today) };
  if (preset === "week") {
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    return { start: midnight(addDays(today, -dow)), end: midnight(addDays(today, 1)) };
  }
  if (preset === "month") return { start: midnight(`${today.slice(0, 8)}01`), end: midnight(addDays(today, 1)) };
  if (!customStart || !customEnd) return { start: midnight(today), end: midnight(addDays(today, 1)), error: "Pick a start and an end date." };
  if (customStart > customEnd) return { start: midnight(today), end: midnight(addDays(today, 1)), error: "The start date is after the end date." };
  return { start: midnight(customStart), end: midnight(addDays(customEnd, 1)) };
}

// ---------- chart colors: validated categorical palette, fixed order ----------

// Every amount here is net USD (the figure that counts toward limits).
const usd = (t) =>
  t.net_usd != null ? Number(t.net_usd) : Number(t.amount) * Number(t.exchange_rate_to_base || 1);

const DRILL_PAGE = 20;
const TABLE_OF = { transaction: "transactions", card: "card_transactions", common: "common_expenses" };

export default function Statistics({ familyId }) {
  const { session } = useAuth();
  const [members, setMembers] = useState([]);
  const [myMember, setMyMember] = useState(null);

  const [selectedMember, setSelectedMember] = useState("all");
  const [preset, setPreset] = useState("month");
  const [customStart, setCustomStart] = useState(() => `${todayKey().slice(0, 8)}01`);
  const [customEnd, setCustomEnd] = useState(() => todayKey());
  const [drill, setDrill] = useState(null); // { name, refs: [{kind, categoryId}], total, count } being inspected
  const [drillRows, setDrillRows] = useState([]);
  const [drillLimit, setDrillLimit] = useState(DRILL_PAGE);
  const [drillLoading, setDrillLoading] = useState(false);

  const [rollup, setRollup] = useState({ total: 0, count: 0, income: 0, daily: [], categories: [], people: [] });
  const [incomeRows, setIncomeRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [familyMoney, setFamilyMoney] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chartHeight, setChartHeight] = useState(300);

  useEffect(() => {
    const onResize = () => setChartHeight(window.innerWidth < 480 ? 180 : window.innerWidth < 768 ? 220 : 300);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const range = useMemo(() => rangeFor(preset, customStart, customEnd), [preset, customStart, customEnd]);

  // Load the records of the chosen period.
  useEffect(() => {
    if (!familyId || !session?.user?.id || range.error) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: fam }, { data: mine }, { data: cats }] = await Promise.all([
          supabase.from("members").select("*").eq("family_id", familyId),
          supabase.from("members").select("*").eq("family_id", familyId).eq("user_id", session.user.id).maybeSingle(),
          supabase.from("categories").select("*").eq("family_id", familyId),
        ]);
        const accts = await loadAccounts(familyId);
        const rate = await latestLbpRate(familyId);
        const money = accts.reduce((sum, a) => sum + (a.currency === "USD" ? bal(a) : rate > 0 ? bal(a) / rate : 0), 0);

        const roll = await spendRollup({
          familyId, from: range.start.toISOString(), to: range.end.toISOString(),
          memberId: selectedMember !== "all" ? selectedMember : null,
        });
        let incQ = supabase.from("deposits").select("*").eq("family_id", familyId).neq("kind", "reimbursement")
          .gte("created_at", range.start.toISOString()).lt("created_at", range.end.toISOString());
        if (selectedMember !== "all") incQ = incQ.eq("beneficiary_member_id", selectedMember);
        const { data: inc } = await incQ.order("created_at", { ascending: false }).limit(50);
        if (cancelled) return;

        setIncomeRows(inc || []);
        setMembers(fam || []);
        setMyMember(mine);
        setCategories(cats || []);
        setFamilyMoney(money);
        setRollup(roll);
      } catch (e) {
        console.error("Error loading statistics:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [familyId, session, selectedMember, range]);

  // Display name of a rolled-up group: the family's category, or a built-in label for records without one.
  const groupName = (g) =>
    categories.find((c) => c.id === g.category_id)?.name ??
    (g.kind === "card" ? "Card spending" : g.kind === "common" ? "Common expenses" : "Uncategorized");

  // Stable color per category name (order of the family's categories, then the built-in ones).
  const colorFor = useMemo(() => makeColorFor(categories), [categories]);

  const stats = useMemo(() => {
    const total = Number(rollup.total);

    const trend = rollup.daily.map((d) => ({ date: formatShortDate(`${d.day}T12:00:00+03:00`), amount: Number(Number(d.total).toFixed(2)) }));

    // Merge groups that share a display name (a category used by expenses and card spends is one row).
    const byCat = {};
    rollup.categories.forEach((g) => {
      const n = groupName(g);
      const e = byCat[n] || (byCat[n] = { name: n, value: 0, count: 0, refs: [], reimbursed: 0 });
      e.value += Number(g.total);
      if (g.kind === "reimbursement") {
        // Money paid back lowers the category; its records are listed too (shown as positive).
        e.reimbursed += Math.abs(Number(g.total));
        e.count += Number(g.count);
        e.refs.push({ kind: "reimbursement", categoryId: g.category_id });
        return;
      }
      e.count += Number(g.count);
      e.refs.push({ kind: g.kind, categoryId: g.category_id });
    });
    const cats = Object.values(byCat).map((c) => ({ ...c, value: Number(c.value.toFixed(2)), reimbursed: Number(c.reimbursed.toFixed(2)) })).filter((c) => c.value > 0 || c.count > 0).sort((a, b) => b.value - a.value);

    const people = rollup.people.map((p) => ({
      name: (p.member_id ? members.find((m) => m.id === p.member_id)?.display_name : null) ?? "Shared family costs",
      amount: Number(Number(p.total).toFixed(2)),
    })).sort((a, b) => b.amount - a.amount);

    const effectiveEnd = Math.min(range.end.getTime(), midnight(addDays(todayKey(), 1)).getTime());
    const days = Math.max(1, Math.round((effectiveEnd - range.start.getTime()) / 86400000));
    return { total, income: Number(rollup.income || 0), trend, cats, people, avgDaily: total / days, top: cats[0] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollup, categories, members, range]);

  const amAdmin = myMember && isAdmin(myMember.role);
  // Records of the opened category, newest first, fetched a page at a time.
  useEffect(() => {
    if (!drill) return;
    let cancelled = false;
    (async () => {
      setDrillLoading(true);
      try {
        const who = selectedMember !== "all" ? selectedMember : null;
        const lists = await Promise.all(drill.refs.map(async (ref) => {
          const reimb = ref.kind === "reimbursement";
          let q = supabase.from(reimb ? "deposits" : TABLE_OF[ref.kind]).select("*").eq("family_id", familyId)
            .match(reimb ? { kind: "reimbursement" } : {})
            .gte("created_at", range.start.toISOString()).lt("created_at", range.end.toISOString());
          q = ref.categoryId ? q.eq("category_id", ref.categoryId) : q.is("category_id", null);
          if (who) q = ref.kind === "transaction" ? q.eq("member_id", who) : reimb ? q.eq("beneficiary_member_id", who) : q.eq("tagged_member_id", who);
          const { data, error } = await q.order("created_at", { ascending: false }).limit(drillLimit);
          if (error) throw error;
          return (data || []).map((r) => (reimb ? { ...r, deposit_kind: "reimbursement", kind: "income" } : { ...r, kind: ref.kind }));
        }));
        if (cancelled) return;
        setDrillRows(lists.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, drillLimit));
      } catch (e) {
        console.error("Error loading category records:", e);
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [drill, drillLimit, familyId, selectedMember, range]);

  const openDrill = (c) => { setDrillRows([]); setDrillLimit(DRILL_PAGE); setDrill({ name: c.name, refs: c.refs, total: c.value, count: c.count, reimbursed: c.reimbursed }); };
  const periodText = `${formatDate(range.start)} – ${formatDate(new Date(range.end.getTime() - 1))}`;

  const tooltipStyle = {
    contentStyle: { backgroundColor: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "8px" },
    labelStyle: { color: "var(--text)" },
    itemStyle: { color: "var(--text)" },
  };

  return (
    <div className="stats-container">
      <div className="stats-header">
        <h1>Statistics</h1>
        <p>Family financial overview and insights</p>
      </div>

      <div className="period-chips" role="group" aria-label="Period">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="chip" aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}>
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="custom-range">
          <div className="filter-group">
            <label htmlFor="start-date">From</label>
            <input id="start-date" type="date" className="filter-input" value={customStart} max={customEnd || undefined} onChange={(e) => setCustomStart(e.target.value)} />
          </div>
          <div className="filter-group">
            <label htmlFor="end-date">To</label>
            <input id="end-date" type="date" className="filter-input" value={customEnd} min={customStart || undefined} max={todayKey()} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
        </div>
      )}
      <p className={`range-note ${range.error ? "error" : ""}`}>{range.error ?? periodText}</p>

      <div className="stats-filters">
        <div className="filter-group">
          <label htmlFor="member-filter">Member</label>
          <select id="member-filter" value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)} className="filter-select">
            <option value="all">All members</option>
            {members.filter((m) => !m.removed_at).map((m) => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
          </select>
        </div>
      </div>

      {loading ? (
        <p>Loading statistics...</p>
      ) : (
        <>
          <div className="stats-summary-cards">
            <div className="summary-card">
              <div className="summary-label">Total spent</div>
              <div className="summary-value">{formatUsd(stats.total)}</div>
              <div className="summary-meta">{rollup.count} record{Number(rollup.count) === 1 ? "" : "s"}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Money in</div>
              <div className="summary-value stat-in">{stats.income > 0 ? "+" : ""}{formatUsd(stats.income)}</div>
              <div className="summary-meta">{incomeRows.length} from outside</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Family money (USD)</div>
              <div className="summary-value">{formatUsd(familyMoney)}</div>
              <div className="summary-meta">Right now, all wallets</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Average per day</div>
              <div className="summary-value">{formatUsd(stats.avgDaily)}</div>
              <div className="summary-meta">In this period</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Top category</div>
              <div className="summary-value" style={{ fontSize: "1.1rem" }}>{stats.top ? stats.top.name : "None"}</div>
              <div className="summary-meta">{stats.top ? formatUsd(stats.top.value) : "No spending yet"}</div>
            </div>
          </div>

          <div className="stats-charts">
            <div className="chart-card">
              <h3>Spending trend</h3>
              <ResponsiveContainer width="100%" height={chartHeight}>
                <LineChart data={stats.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" stroke="var(--text-muted)" />
                  <YAxis stroke="var(--text-muted)" tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v) => formatUsd(v)} {...tooltipStyle} />
                  <Line type="monotone" dataKey="amount" stroke="var(--viz-1)" strokeWidth={2} dot={{ fill: "var(--viz-1)", r: 4, stroke: "var(--surface)", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="chart-card">
              <h3>Spending by category</h3>
              {stats.cats.length === 0 ? (
                <p className="hint">Nothing in this period.</p>
              ) : (
                <>
                  <ul className="cat-list">
                    {stats.cats.map((c) => {
                      const share = stats.total > 0 ? c.value / stats.total : 0;
                      return (
                        <li key={c.name}>
                          <button type="button" className="cat-row" onClick={() => openDrill(c)} aria-label={`${c.name}: ${formatUsd(c.value)}. Show records`}>
                            <span className="cat-top">
                              <span className="cat-name">
                                <span className="cat-swatch" style={{ background: colorFor(c.name) }} />
                                <span>{c.name}{c.reimbursed > 0 && <span className="cat-share"> · {formatUsd(c.reimbursed)} paid back</span>}</span>
                              </span>
                              <span className="cat-amount">{formatUsd(c.value)}<span className="cat-share">{Math.round(share * 100)}%</span></span>
                            </span>
                            <span className="cat-track" aria-hidden="true"><span className="cat-fill" style={{ display: "block", width: `${Math.max(share * 100, 1)}%`, background: colorFor(c.name) }} /></span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="cat-hint">Tap a category to see its records.</p>
                </>
              )}
            </div>

            {incomeRows.length > 0 && (
              <div className="chart-card">
                <h3>Money in</h3>
                <ul className="cat-list">
                  {incomeRows.slice(0, 10).map((r) => {
                    const t = INCOME_TYPES.find((x) => x.key === r.kind)?.label || "Deposit";
                    const who = members.find((m) => m.id === r.beneficiary_member_id)?.display_name;
                    return (
                      <li key={r.id} className="inc-row">
                        <span><strong>{t}</strong><span className="cat-share"> {who ? `· ${who} ` : "· Family "}· {formatShortDate(r.created_at)}{r.note ? ` · ${r.note}` : ""}</span></span>
                        <span className="stat-in">+{r.currency === "USD" ? formatUsd(r.amount) : `${Math.round(Number(r.amount)).toLocaleString("en-US")} LBP`}</span>
                      </li>
                    );
                  })}
                </ul>
                {incomeRows.length > 10 && <p className="cat-hint">Showing the latest 10 of {incomeRows.length}.</p>}
              </div>
            )}

            {amAdmin && selectedMember === "all" && stats.people.length > 0 && (
              <div className="chart-card full-width">
                <h3>Spending by person</h3>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={stats.people}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" stroke="var(--text-muted)" />
                    <YAxis stroke="var(--text-muted)" tickFormatter={(v) => `$${v}`} />
                    <Tooltip formatter={(v) => formatUsd(v)} cursor={{ fill: "var(--surface-hover)" }} {...tooltipStyle} />
                    <Bar dataKey="amount" fill="var(--viz-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <p className="cat-hint">Card spending and family costs are counted for the person they were spent for.</p>
              </div>
            )}
          </div>

          {Number(rollup.count) === 0 && incomeRows.length === 0 && (
            <div className="empty-state"><p>No records found for this period and member.</p></div>
          )}
        </>
      )}

      {drill && (
        <div className="sheet-backdrop" onClick={() => setDrill(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <h2>{drill.name}</h2>
              <button type="button" className="sheet-close" aria-label="Close" onClick={() => setDrill(null)}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="sheet-body">
              <p className="hint">{drill.count} record{drill.count === 1 ? "" : "s"} · {formatUsd(drill.total)}{drill.reimbursed > 0 ? ` after ${formatUsd(drill.reimbursed)} paid back` : ""} · {periodText}</p>
              <ul className="txn-list">
                {drillRows.map((r) => r.kind === "income" ? (
                  <IncomeRow key={`income-${r.id}`} t={r} categories={categories} members={members} canManage={false} onChanged={() => {}} />
                ) : (
                  <TransactionRow key={`${r.kind}-${r.id}`} t={r} categories={categories} members={members} canManage={false} onChanged={() => {}} />
                ))}
              </ul>
              {drillRows.length < drill.count && (
                <button type="button" className="load-more" disabled={drillLoading} onClick={() => setDrillLimit((l) => l + DRILL_PAGE)}>
                  {drillLoading ? "Loading..." : "Load more"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
