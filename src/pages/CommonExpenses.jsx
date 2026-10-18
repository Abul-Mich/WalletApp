import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  deleteCommonExpense, updateCommonExpense, createCommonBill, deleteCommonBill, payCommonBill,
  latestLbpRate, periodStart, bal,
} from "../lib/wallets";
import { formatUsd, formatMoney, formatDate, formatDateTime, formatRate, parseNumber } from "../lib/format";
import { MoneyInput, TextInput, SelectInput } from "../components/Field";

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

  async function remove(e) {
    if (!confirm(`Delete "${e.title}"? The money goes back to ${sourceName(e.account_id) ?? "the family pool"}.`)) return;
    setError(null);
    try {
      await deleteCommonExpense(e.id);
      done();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeBill(b) {
    if (!confirm(`Delete the bill "${b.name}"? Payments already made stay in the list.`)) return;
    setError(null);
    try {
      await deleteCommonBill(b.id);
      done();
    } catch (err) {
      setError(err.message);
    }
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
    </section>
  );
}

function ExpenseRow({ e, name, catName, sourceName, amAdmin, onRemove, env }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="txn-edit">
        <CommonExpenseEditForm record={e} {...env} onSaved={() => { setEditing(false); env.onChanged(); }} onCancel={() => setEditing(false)} />
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

// Change a common expense: what it was for, amount, currency, category, person, date, note, and where it is paid from.
function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CommonExpenseEditForm({ record, members, categories, cards, accounts, onSaved, onCancel }) {
  const [title, setTitle] = useState(record.title);
  const [amount, setAmount] = useState(String(Number(record.amount)));
  const [currency, setCurrency] = useState(record.currency);
  const [rate, setRate] = useState(record.lbp_per_usd ? String(Math.round(Number(record.lbp_per_usd))) : "");
  const [categoryId, setCategoryId] = useState(record.category_id ?? "");
  const [tag, setTag] = useState(record.tagged_member_id ?? "");
  const [when, setWhen] = useState(toLocalInput(record.created_at));
  const [note, setNote] = useState(record.note ?? "");
  const [accountId, setAccountId] = useState(record.account_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Cards that can pay in this currency, plus the one it is paid from now (even if archived).
  const options = cardOptions(cards, accounts, currency);
  const currentCard = (cards || []).find((k) => accounts.cards[k.id]?.id === record.account_id);
  if (currentCard && currency === record.currency && !options.some((o) => o.id === record.account_id)) {
    options.push({ id: record.account_id, label: `${currentCard.name} (${formatMoney(bal(accounts.cards[currentCard.id]), currency)})` });
  }
  const chosen = options.some((o) => o.id === accountId) ? accountId : "";

  async function save(ev) {
    ev.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    if (currency === "LBP" && !(parseNumber(rate) > 0)) return setError("Enter the exchange rate (LBP per $1).");
    setBusy(true);
    setError(null);
    try {
      await updateCommonExpense({
        id: record.id, title, amount: n, currency, categoryId, note, taggedMemberId: tag,
        accountId: chosen,
        lbpPerUsd: currency === "LBP" ? parseNumber(rate) : null,
        createdAt: when ? new Date(when).toISOString() : null,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="form-stack">
      <TextInput label="What for" value={title} onChange={setTitle} required />
      <div className="grid">
        <MoneyInput label="Amount" unit={currency} value={amount} onChange={setAmount} placeholder="0" required />
        <SelectInput label="Currency" value={currency} onChange={setCurrency}>
          <option value="USD">US dollars (USD)</option>
          <option value="LBP">Lebanese pounds (LBP)</option>
        </SelectInput>
      </div>
      {currency === "LBP" && (
        <MoneyInput label="Exchange rate" unit="LBP/USD" value={rate} onChange={setRate} placeholder="89,500" required
          help={parseNumber(rate) > 0 ? formatRate(parseNumber(rate)) : "How many LBP equal $1 today"} />
      )}
      <div className="grid">
        <SelectInput label="Category" value={categoryId} onChange={setCategoryId}>
          <option value="">No category</option>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </SelectInput>
        <SelectInput label="For (optional)" value={tag} onChange={setTag}>
          <option value="">The whole family</option>
          {members.filter((m) => !m.removed_at || m.id === tag).map((m) => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
        </SelectInput>
      </div>
      <PaidFrom value={chosen} onChange={setAccountId} options={options} />
      <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} />
      <TextInput label="Note" value={note} onChange={setNote} placeholder="Optional" />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="status error">{error}</p>}
    </form>
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

function BillForm({ familyId, members, categories, onDone, onCancel }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [recurrence, setRecurrence] = useState("monthly");
  const [due, setDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter the usual amount.");
    setBusy(true);
    setError(null);
    try {
      await createCommonBill({ familyId, name, amount: n, currency, recurrence, nextDue: due, categoryId, taggedMemberId: tag });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-stack group" style={{ marginBottom: 12 }}>
      <h4>New recurring bill</h4>
      <TextInput label="Name" value={name} onChange={setName} placeholder="Internet, electricity, tuition..." required />
      <div className="grid">
        <MoneyInput label="Usual amount" unit={currency} value={amount} onChange={setAmount} placeholder="0" required help="You can change it when you pay" />
        <SelectInput label="Currency" value={currency} onChange={setCurrency}>
          <option value="USD">US dollars (USD)</option>
          <option value="LBP">Lebanese pounds (LBP)</option>
        </SelectInput>
      </div>
      <div className="grid">
        <SelectInput label="Repeats" value={recurrence} onChange={setRecurrence}>
          <option value="monthly">Every month</option>
          <option value="weekly">Every week</option>
          <option value="one_time">One time</option>
        </SelectInput>
        <TextInput label="Next due date" type="date" value={due} onChange={setDue} required />
      </div>
      <div className="grid">
        <SelectInput label="Category" value={categoryId} onChange={setCategoryId}>
          <option value="">No category</option>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </SelectInput>
        <SelectInput label="For (optional)" value={tag} onChange={setTag}>
          <option value="">The whole family</option>
          {members.map((m) => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
        </SelectInput>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving..." : "Add bill"}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}

// Pay a bill from the pool. The amount starts as the usual one; change it if this month's bill differs.
function PayForm({ bill, cards, accounts, defaultRate, onDone, onCancel }) {
  const [amount, setAmount] = useState(String(bill.amount));
  const [rate, setRate] = useState(defaultRate);
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const options = cardOptions(cards, accounts, bill.currency);

  async function submit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    setBusy(true);
    setError(null);
    try {
      await payCommonBill({ billId: bill.id, amount: n, accountId, lbpPerUsd: bill.currency === "LBP" ? parseNumber(rate) : null });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-stack" style={{ marginTop: 10 }}>
      <div className="grid">
        <MoneyInput label={`Amount this time`} unit={bill.currency} value={amount} onChange={setAmount} required />
        {bill.currency === "LBP" && <MoneyInput label="Exchange rate" unit="LBP/USD" value={rate} onChange={setRate} required />}
      </div>
      <PaidFrom value={accountId} onChange={setAccountId} options={options} />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Paying..." : accountId ? "Pay from card" : "Pay from pool"}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
