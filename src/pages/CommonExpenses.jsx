import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  deleteCommonExpense, updateCommonExpense, createCommonBill, deleteCommonBill, payCommonBill,
  latestLbpRate, periodStart, bal,
} from "../lib/wallets";
import { formatUsd, formatMoney, formatDate, formatDateTime, formatRate, parseNumber, convertAmountText } from "../lib/format";
import { MoneyInput, TextInput, SelectInput } from "../components/Field";
import { useConfirm } from "../components/ConfirmSheet";
import AmountHero from "../components/AmountHero";
import { CategoryChips, PersonChips, DateNote, ImpactCard, EditSheet, signed } from "../components/RecordFields";

const BILLS_SHOWN = 5;

// Cards/wallets that can pay an expense in this currency: [{id (account id), label}]
function cardOptions(cards, accounts, currency) {
  return (cards || [])
    .filter((k) => !k.archived)
    .map((k) => ({ k, a: accounts.cards[k.id] }))
    .filter(({ a }) => a && a.currency === currency)
    .map(({ k, a }) => ({ id: a.id, label: `${k.name} (${formatMoney(bal(a), currency)})` }));
}

function PaidFrom({ value, onChange, options }) {
  if (options.length === 0) return null;
  return (
    <SelectInput label="Paid from" value={value} onChange={onChange}>
      <option value="">Family pool</option>
      {options.map((o) => (<option key={o.id} value={o.id}>{o.label}</option>))}
    </SelectInput>
  );
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr) - today) / 86400000);
}

// Family-wide costs paid from the pool (admins record them; everyone can see them).
// They count toward the family budget, never toward a member's personal limit.
export default function CommonExpenses({ familyId, members, categories, amAdmin, accounts, cards = [], reloadTrigger, onChanged }) {
  const [expenses, setExpenses] = useState([]); // the 3 newest
  const [monthRows, setMonthRows] = useState([]); // everything this month, for the totals
  const [showHistory, setShowHistory] = useState(false);
  const [tick, setTick] = useState(0); // bumps after every change so the open history list reloads
  const [bills, setBills] = useState([]);
  const [monthStart, setMonthStart] = useState(null);
  const [rate, setRate] = useState("");
  const { ask, dialog } = useConfirm();
  const [showAllBills, setShowAllBills] = useState(false);
  const [mode, setMode] = useState(null); // null | 'bill'
  const [paying, setPaying] = useState(null); // bill being paid
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const start = await periodStart("monthly");
    const [{ data: ex }, { data: mo }, { data: bl }, r] = await Promise.all([
      supabase.from("common_expenses").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(3),
      supabase.from("common_expenses").select("net_usd, tagged_member_id, created_at").eq("family_id", familyId).gte("created_at", start),
      supabase.from("common_bills").select("*").eq("family_id", familyId).eq("is_active", true).order("next_due_date"),
      latestLbpRate(familyId),
    ]);
    setExpenses(ex || []);
    setMonthRows(mo || []);
    setBills(bl || []);
    setMonthStart(start);
    if (r) setRate(String(r));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, reloadTrigger]);

  const env = { members, categories, cards, accounts, onChanged: () => done() };
  const name = (id) => members.find((m) => m.id === id)?.display_name;
  const sourceName = (acctId) => {
    const cardId = Object.keys(accounts.cards).find((k) => accounts.cards[k].id === acctId);
    return cardId ? cards.find((k) => k.id === cardId)?.name : null;
  };
  const catName = (id) => categories.find((c) => c.id === id)?.name;

  const { monthTotal, byPerson } = useMemo(() => {
    const since = monthStart ? new Date(monthStart) : null;
    let total = 0;
    const per = {};
    for (const e of monthRows) {
      if (since && new Date(e.created_at) < since) continue;
      total += Number(e.net_usd);
      if (e.tagged_member_id) per[e.tagged_member_id] = (per[e.tagged_member_id] || 0) + Number(e.net_usd);
    }
    return { monthTotal: total, byPerson: Object.entries(per).sort((a, b) => b[1] - a[1]) };
  }, [monthRows, monthStart]);

  function done() {
    setTick((t) => t + 1);
    setMode(null);
    setPaying(null);
    load();
    onChanged?.();
  }

  function remove(e) {
    const back = sourceName(e.account_id) ?? "the family pool";
    ask({
      title: "Delete this family cost?",
      detail: `${e.title} · ${formatMoney(e.amount, e.currency)}`,
      effect: `The money goes back to ${back}, and the family budget and statistics are recalculated. This cannot be undone.`,
      confirmLabel: "Delete family cost", cancelLabel: "Keep it", icon: "trash",
      onConfirm: async () => {
        setError(null);
        await deleteCommonExpense(e.id);
        done();
      },
    });
  }

  function removeBill(b) {
    ask({
      title: `Delete the bill "${b.name}"?`,
      effect: "Payments already made stay in the list. Only the reminder is removed.",
      confirmLabel: "Delete bill", cancelLabel: "Keep it", icon: "trash",
      onConfirm: async () => {
        setError(null);
        await deleteCommonBill(b.id);
        done();
      },
    });
  }

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Common expenses</h2>
        {amAdmin && !mode && (
          <div className="form-actions" style={{ flex: "0 0 auto" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode("bill")}>Add bill</button>
          </div>
        )}
      </div>
      <p className="hint">
        Paid from the family pool by default ({formatUsd(bal(accounts.pool.USD))} · {formatMoney(bal(accounts.pool.LBP), "LBP")}). They count toward the family budget, not anyone's personal limit.
      </p>

      {mode === "bill" && (
        <BillForm familyId={familyId} members={members} categories={categories} onDone={done} onCancel={() => setMode(null)} />
      )}

      <div className="net-line" style={{ margin: "12px 0" }}>
        <span>This month</span>
        <strong>{formatUsd(monthTotal)}</strong>
      </div>
      {byPerson.length > 0 && (
        <ul className="breakdown-list" style={{ marginBottom: 12 }}>
          {byPerson.map(([id, total]) => (
            <li key={id}><div className="breakdown-row"><span>For {name(id) ?? "a member"}</span><span>{formatUsd(total)}</span></div></li>
          ))}
        </ul>
      )}

      <h3 className="subsection">Upcoming bills</h3>
      {bills.length === 0 && <p className="hint">No recurring common bills yet.</p>}
      <ul className="bill-list">
        {(showAllBills ? bills : bills.slice(0, BILLS_SHOWN)).map((b) => {
          const days = daysUntil(b.next_due_date);
          const status = days < 0 ? "overdue" : days <= 3 ? "soon" : "";
          return (
            <li key={b.id} className={`bill-row ${status}`}>
              <div className="breakdown-row">
                <span>
                  {b.name} <span className="txn-meta">({b.recurrence === "one_time" ? "one time" : b.recurrence}{b.tagged_member_id ? ` · for ${name(b.tagged_member_id) ?? "a member"}` : ""})</span>
                </span>
                <span>{formatMoney(b.amount, b.currency)}</span>
              </div>
              <div className="bill-meta">
                <span>
                  {days < 0 ? `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue` : days === 0 ? "Due today" : `Due in ${days} day${days === 1 ? "" : "s"}`} ({formatDate(b.next_due_date)})
                </span>
                {amAdmin && (
                  <div className="bill-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setPaying(paying?.id === b.id ? null : b)}>Pay</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeBill(b)}>Delete</button>
                  </div>
                )}
              </div>
              {paying?.id === b.id && <PayForm bill={b} cards={cards} accounts={accounts} defaultRate={rate} onDone={done} onCancel={() => setPaying(null)} />}
            </li>
          );
        })}
      </ul>
      {bills.length > BILLS_SHOWN && (
        <button type="button" className="load-more" onClick={() => setShowAllBills((v) => !v)}>
          {showAllBills ? "Show fewer" : `Show all ${bills.length} bills`}
        </button>
      )}

      <h3 className="subsection">Recent</h3>
      {expenses.length === 0 && <p className="hint">Nothing recorded yet.</p>}
      <ul className="txn-list">
        {expenses.map((e) => (
          <ExpenseRow key={e.id} e={e} name={name} catName={catName} sourceName={sourceName} amAdmin={amAdmin} onRemove={remove} env={env} />
        ))}
      </ul>
      {expenses.length >= 3 ? (
        <button type="button" className="load-more" onClick={() => setShowHistory(true)}>More</button>
      ) : null}
      {error && <p className="status error">{error}</p>}
      {showHistory && (
        <HistorySheet
          familyId={familyId} name={name} catName={catName} sourceName={sourceName} amAdmin={amAdmin}
          onRemove={remove} env={env} reloadKey={tick}
          onClose={() => setShowHistory(false)}
        />
      )}
      {dialog}
    </section>
  );
}

function ExpenseRow({ e, name, catName, sourceName, amAdmin, onRemove, env }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="txn-edit-host">
        <CommonExpenseEditForm record={e} {...env} onSaved={() => { setEditing(false); env.onChanged(); }} onCancel={() => setEditing(false)} onDelete={() => onRemove(e)} />
      </li>
    );
  }
  return (
    <li>
      <div>
        <span className="txn-amount">
          {formatUsd(-e.net_usd)}
          {e.currency !== "USD" && <span className="txn-converted"> ({formatMoney(e.amount, e.currency)})</span>}
        </span>
        <span className="txn-meta">
          {e.title}{catName(e.category_id) ? ` · ${catName(e.category_id)}` : ""}{e.tagged_member_id ? ` · for ${name(e.tagged_member_id) ?? "a member"}` : ""}{sourceName(e.account_id) ? ` · paid from ${sourceName(e.account_id)}` : ""} · {formatDateTime(e.created_at)}
        </span>
      </div>
      {e.note && <p className="txn-note">{e.note}</p>}
      {amAdmin && (
        <div className="txn-actions">
          <button type="button" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="remove-btn" onClick={() => onRemove(e)}>Delete</button>
        </div>
      )}
    </li>
  );
}

// Change a family cost: what it was for, amount, currency, category, person, date, note, and where it is paid from.
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const numOf = (v) => {
  const n = parseNumber(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function CommonExpenseEditForm({ record, members, categories, cards, accounts, onSaved, onCancel, onDelete }) {
  const oldWhen = toLocalInput(record.created_at);
  const oldAmount = Number(record.amount);
  const oldNet = Math.abs(Number(record.net_usd));
  const [title, setTitle] = useState(record.title);
  const [amount, setAmount] = useState(String(oldAmount));
  const [currency, setCurrency] = useState(record.currency);
  const [rate, setRate] = useState(record.lbp_per_usd ? String(Math.round(Number(record.lbp_per_usd))) : "");
  const [categoryId, setCategoryId] = useState(record.category_id ?? "");
  const [tag, setTag] = useState(record.tagged_member_id ?? "");
  const [when, setWhen] = useState(oldWhen);
  const [note, setNote] = useState(record.note ?? "");
  const [accountId, setAccountId] = useState(record.account_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // A USD expense has no rate of its own: offer the family's latest one if it is switched to LBP.
  useEffect(() => {
    if (!rate) latestLbpRate(record.family_id).then((r) => r && setRate(String(Math.round(Number(r)))));
  }, [record.family_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rateNum = numOf(rate);

  // Switching currency keeps the value: the amount is converted at the rate shown.
  function changeCurrency(c) {
    if (c === currency) return;
    setAmount(convertAmountText(amount, currency, c, rateNum));
    setCurrency(c);
  }

  // Where it can be paid from in this currency: the pool, active cards, and the current card even if archived.
  const sources = [{ id: "", name: "Family pool", balance: bal(accounts.pool?.[currency]), cur: currency }];
  for (const k of cards || []) {
    const a = accounts.cards[k.id];
    if (!a || a.currency !== currency) continue;
    if (k.archived && a.id !== record.account_id) continue;
    sources.push({ id: a.id, name: k.name, balance: bal(a), cur: currency });
  }
  const chosen = sources.some((o) => o.id === accountId) ? accountId : "";
  const oldSourceName = record.account_id
    ? (cards || []).find((k) => accounts.cards[k.id]?.id === record.account_id)?.name ?? "the card"
    : "Family pool";
  const newSourceName = sources.find((o) => o.id === chosen)?.name ?? "Family pool";

  const n = numOf(amount);
  const newNet = currency === "USD" ? n : rateNum ? n / rateNum : 0;
  const sameSource = chosen === (record.account_id ?? "") && currency === record.currency;
  const changed =
    title !== record.title || Math.abs(n - oldAmount) > 1e-9 || currency !== record.currency ||
    (currency === "LBP" && Math.abs(rateNum - Number(record.lbp_per_usd || 0)) > 0.5) ||
    categoryId !== (record.category_id ?? "") || tag !== (record.tagged_member_id ?? "") ||
    when !== oldWhen || note !== (record.note ?? "") || chosen !== (record.account_id ?? "");

  const rows = [];
  if (n > 0) {
    if (sameSource) {
      if (Math.abs(n - oldAmount) > 1e-9) rows.push({ name: `${newSourceName} balance`, value: signed(oldAmount - n, (v) => formatMoney(v, currency)) });
    } else {
      rows.push({ name: `${oldSourceName} gets back`, value: formatMoney(oldAmount, record.currency) });
      rows.push({ name: `${newSourceName} pays`, value: formatMoney(n, currency) });
    }
    if (newNet > 0 && Math.abs(newNet - oldNet) > 0.004) rows.push({ name: "Family budget this month", value: signed(newNet - oldNet, formatUsd) });
  }

  async function save(ev) {
    ev.preventDefault();
    if (!(n > 0)) return setError("Enter an amount.");
    if (!title.trim()) return setError("Enter what the family cost was for.");
    if (currency === "LBP" && !(rateNum > 0)) return setError("Enter the exchange rate (LBP per $1).");
    if (when && new Date(when) > new Date()) return setError("The date cannot be in the future.");
    setBusy(true);
    setError(null);
    try {
      await updateCommonExpense({
        id: record.id, title, amount: n, currency, categoryId, note, taggedMemberId: tag,
        accountId: chosen,
        lbpPerUsd: currency === "LBP" ? rateNum : null,
        createdAt: when ? new Date(when).toISOString() : null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const people = [{ value: "", label: "Nobody" }, ...(members || []).filter((m) => !m.removed_at || m.id === tag).map((m) => ({ value: m.id, label: m.display_name }))];

  return (
    <EditSheet title="Edit family cost" onClose={busy ? undefined : onCancel}>
      <form onSubmit={save} className="spend-form">
        <div className="sf-scroll">
          <AmountHero value={amount} onChange={setAmount} currency={currency} onCurrency={changeCurrency} autoFocus={false}>
            {(Math.abs(n - oldAmount) > 1e-9 || currency !== record.currency) && (
              <span className="sf-muted sf-small">Was {formatMoney(oldAmount, record.currency)}{currency === "LBP" && newNet > 0 ? ` · now about ${formatUsd(newNet)}` : ""}</span>
            )}
          </AmountHero>

          {currency === "LBP" && (
            <MoneyInput label="Exchange rate (LBP per $1)" value={rate} onChange={setRate} placeholder="89,500" required
              help={rateNum ? formatRate(rateNum) : "How many LBP equal $1 today"} />
          )}

          <TextInput label="What for" value={title} onChange={setTitle} required />

          <div className="sf-block">
            <span className="sf-label">Paid from</span>
            <div className="sf-boxes">
              {sources.map((o) => (
                <button key={o.id || "pool"} type="button" className={`sf-box ${chosen === o.id ? "on" : ""}`} aria-pressed={chosen === o.id} onClick={() => setAccountId(o.id)}>
                  <strong>{o.name}</strong><span>{formatMoney(o.balance, o.cur)}</span>
                </button>
              ))}
            </div>
          </div>

          <PersonChips label="Related person" hint="(optional)" value={tag} onChange={setTag} options={people} />
          <CategoryChips categories={categories || []} value={categoryId} onChange={setCategoryId} allowNone />
          <ImpactCard rows={changed ? rows : []} />
          <DateNote when={when} onWhen={setWhen} note={note} onNote={setNote} />
          {error && <p className="status error" role="alert">{error}</p>}
        </div>

        <div className="sf-footer sf-footer-stack">
          <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !changed || !(n > 0)}>
            {busy ? "Saving..." : changed ? "Save changes" : "No changes yet"}
          </button>
          {onDelete && <button type="button" className="sf-delete" disabled={busy} onClick={onDelete}>Delete this family cost</button>}
        </div>
      </form>
    </EditSheet>
  );
}

// Every common expense, 20 at a time.
function HistorySheet({ familyId, name, catName, sourceName, amAdmin, onRemove, env, reloadKey, onClose }) {
  const PAGE = 20;
  const [rows, setRows] = useState([]);
  const [limit, setLimit] = useState(PAGE);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from("common_expenses").select("*").eq("family_id", familyId)
        .order("created_at", { ascending: false }).limit(limit + 1);
      if (cancelled) return;
      setRows((data || []).slice(0, limit));
      setMore((data || []).length > limit);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [familyId, limit, reloadKey]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(ev) => ev.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>Common expenses</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="sheet-body">
          {!loading && rows.length === 0 && <p className="hint">Nothing recorded yet.</p>}
          <ul className="txn-list">
            {rows.map((e) => (
              <ExpenseRow key={e.id} e={e} name={name} catName={catName} sourceName={sourceName} amAdmin={amAdmin} onRemove={onRemove} env={env} />
            ))}
          </ul>
          {more && (
            <button type="button" className="load-more" disabled={loading} onClick={() => setLimit((l) => l + PAGE)}>
              {loading ? "Loading..." : "Load 20 more"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function dueChoices() {
  const today = new Date();
  const week = new Date(today); week.setDate(week.getDate() + 7);
  const month = new Date(today.getFullYear(), today.getMonth() + 1, Math.min(today.getDate(), 28));
  return [
    { key: "today", label: "Today", value: ymd(today) },
    { key: "week", label: "In a week", value: ymd(week) },
    { key: "month", label: "Next month", value: ymd(month) },
  ];
}

// A new bill: the hero is the usual amount. Due date has quick choices and a date picker.
function BillForm({ familyId, members, categories, onDone, onCancel }) {
  const choices = dueChoices();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [recurrence, setRecurrence] = useState("monthly");
  const [due, setDue] = useState(choices[1].value);
  const [pickDate, setPickDate] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    latestLbpRate(familyId).then((r) => r && setRate(String(Math.round(Number(r)))));
  }, [familyId]);

  function changeCurrency(c) {
    if (c === currency) return;
    setAmount(convertAmountText(amount, currency, c, numOf(rate)));
    setCurrency(c);
  }

  const n = numOf(amount);
  const repeatWord = { monthly: "every month", weekly: "every week", one_time: "once" }[recurrence];
  const dueLabel = new Date(`${due}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setError("Give the bill a name.");
    if (!(n > 0)) return setError("Enter the usual amount.");
    if (!due) return setError("Choose the next due date.");
    setBusy(true);
    setError(null);
    try {
      await createCommonBill({ familyId, name, amount: n, currency, recurrence, nextDue: due, categoryId, taggedMemberId: tag });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const people = [{ value: "", label: "Whole family" }, ...(members || []).map((m) => ({ value: m.id, label: m.display_name }))];

  return (
    <EditSheet title="Add a bill" onClose={busy ? undefined : onCancel}>
      <form onSubmit={submit} className="spend-form">
        <div className="sf-scroll">
          <TextInput label="Name" value={name} onChange={setName} placeholder="Internet, electricity, tuition..." required />
          <AmountHero value={amount} onChange={setAmount} currency={currency} onCurrency={changeCurrency} autoFocus={false}>
            <span className="sf-muted sf-small">Usual amount. You can change it each time you pay.</span>
          </AmountHero>

          <div className="sf-block">
            <span className="sf-label">Repeats</span>
            <div className="sf-seg" role="group" aria-label="Repeats">
              {[["monthly", "Every month"], ["weekly", "Every week"], ["one_time", "One time"]].map(([k, l]) => (
                <button key={k} type="button" className={recurrence === k ? "on" : ""} aria-pressed={recurrence === k} onClick={() => setRecurrence(k)}>{l}</button>
              ))}
            </div>
          </div>

          <div className="sf-block">
            <span className="sf-label">Next due</span>
            <div className="sf-chips">
              {choices.map((c) => (
                <button key={c.key} type="button" className={`sf-chip ${!pickDate && due === c.value ? "on" : ""}`} aria-pressed={!pickDate && due === c.value} onClick={() => { setPickDate(false); setDue(c.value); }}>{c.label}</button>
              ))}
              <button type="button" className={`sf-chip ${pickDate ? "on" : ""}`} aria-pressed={pickDate} onClick={() => setPickDate(true)}>Pick date</button>
            </div>
            {pickDate ? <TextInput label="" type="date" value={due} onChange={setDue} required /> : <span className="sf-muted sf-small" style={{ marginTop: 8 }}>{dueLabel}</span>}
          </div>

          <CategoryChips categories={categories || []} value={categoryId} onChange={setCategoryId} allowNone />
          <PersonChips label="For" hint="(optional)" value={tag} onChange={setTag} options={people} />
          {error && <p className="status error" role="alert">{error}</p>}
        </div>
        <div className="sf-footer">
          <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !name.trim() || !(n > 0)}>
            {busy ? "Saving..." : n > 0 ? `Add bill · ${formatMoney(n, currency)} ${repeatWord}` : "Enter a name and amount"}
          </button>
        </div>
      </form>
    </EditSheet>
  );
}

// Pay a bill. The amount starts as the usual one; change it if this month's bill differs.
function PayForm({ bill, cards, accounts, defaultRate, onDone, onCancel }) {
  const cur = bill.currency;
  const [amount, setAmount] = useState(String(Number(bill.amount)));
  const [rate, setRate] = useState(defaultRate);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const sources = [{ id: "", name: "Family pool", balance: bal(accounts.pool?.[cur]) }];
  for (const k of cards || []) {
    const a = accounts.cards[k.id];
    if (a && !k.archived && a.currency === cur) sources.push({ id: a.id, name: k.name, balance: bal(a) });
  }
  const chosen = sources.find((o) => o.id === accountId) || sources[0];
  const n = numOf(amount);
  const rateNum = numOf(rate);
  const over = n > chosen.balance + 1e-9;
  const needsRate = cur === "LBP";
  const valid = n > 0 && !over && (!needsRate || rateNum > 0);

  async function submit(e) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await payCommonBill({ billId: bill.id, amount: n, accountId: chosen.id, lbpPerUsd: needsRate ? rateNum : null });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const label = over ? `Not enough in ${chosen.name}` : valid ? `Pay ${formatMoney(n, cur)} from ${chosen.id ? chosen.name : "pool"}` : needsRate && n > 0 ? "Enter the exchange rate" : "Enter an amount";

  return (
    <EditSheet title={`Pay ${bill.name}`} onClose={busy ? undefined : onCancel}>
      <form onSubmit={submit} className="spend-form">
        <div className="sf-scroll">
          <AmountHero value={amount} onChange={setAmount} currency={cur} autoFocus={false}>
            <span className="sf-muted sf-small">Usual amount: {formatMoney(Number(bill.amount), cur)}</span>
            {needsRate && n > 0 && rateNum > 0 && <span className="sf-muted sf-small">≈ {formatUsd(n / rateNum)} at {Math.round(rateNum).toLocaleString("en-US")}</span>}
          </AmountHero>
          {needsRate && (
            <MoneyInput label="Exchange rate (LBP per $1)" value={rate} onChange={setRate} placeholder="89,500" required
              help={rateNum ? formatRate(rateNum) : "How many LBP equal $1 today"} />
          )}
          <div className="sf-block">
            <span className="sf-label">Pay from</span>
            <div className="sf-boxes">
              {sources.map((o) => (
                <button key={o.id || "pool"} type="button" className={`sf-box ${chosen.id === o.id ? "on" : ""}`} aria-pressed={chosen.id === o.id} onClick={() => setAccountId(o.id)}>
                  <strong>{o.name}</strong><span>{formatMoney(o.balance, cur)}</span>
                </button>
              ))}
            </div>
          </div>
          {error && <p className="status error" role="alert">{error}</p>}
        </div>
        <div className="sf-footer">
          <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !valid}>{busy ? "Paying..." : label}</button>
        </div>
      </form>
    </EditSheet>
  );
}
