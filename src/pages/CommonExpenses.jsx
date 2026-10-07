import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  createCommonExpense, deleteCommonExpense, createCommonBill, deleteCommonBill, payCommonBill,
  latestLbpRate, periodStart, bal,
} from "../lib/wallets";
import { formatUsd, formatMoney, formatDate, formatDateTime, formatRate, parseNumber } from "../lib/format";
import { MoneyInput, TextInput, SelectInput } from "../components/Field";

const SUGGESTIONS = ["Electricity", "Water", "Internet", "Generator", "Rent", "Tuition", "Phone", "Insurance"];

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr) - today) / 86400000);
}

// Family-wide costs paid from the pool (admins record them; everyone can see them).
// They count toward the family budget, never toward a member's personal limit.
export default function CommonExpenses({ familyId, members, categories, amAdmin, accounts, reloadTrigger, onChanged }) {
  const [expenses, setExpenses] = useState([]);
  const [bills, setBills] = useState([]);
  const [monthStart, setMonthStart] = useState(null);
  const [rate, setRate] = useState("");
  const [mode, setMode] = useState(null); // null | 'expense' | 'bill'
  const [paying, setPaying] = useState(null); // bill being paid
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [{ data: ex }, { data: bl }, start, r] = await Promise.all([
      supabase.from("common_expenses").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(60),
      supabase.from("common_bills").select("*").eq("family_id", familyId).eq("is_active", true).order("next_due_date"),
      periodStart("monthly"),
      latestLbpRate(familyId),
    ]);
    setExpenses(ex || []);
    setBills(bl || []);
    setMonthStart(start);
    if (r) setRate(String(r));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, reloadTrigger]);

  const name = (id) => members.find((m) => m.id === id)?.display_name;
  const catName = (id) => categories.find((c) => c.id === id)?.name;

  const { monthTotal, byPerson } = useMemo(() => {
    const since = monthStart ? new Date(monthStart) : null;
    let total = 0;
    const per = {};
    for (const e of expenses) {
      if (since && new Date(e.created_at) < since) continue;
      total += Number(e.net_usd);
      if (e.tagged_member_id) per[e.tagged_member_id] = (per[e.tagged_member_id] || 0) + Number(e.net_usd);
    }
    return { monthTotal: total, byPerson: Object.entries(per).sort((a, b) => b[1] - a[1]) };
  }, [expenses, monthStart]);

  function done() {
    setMode(null);
    setPaying(null);
    load();
    onChanged?.();
  }

  async function remove(e) {
    if (!confirm(`Delete "${e.title}"? The money goes back to the family pool.`)) return;
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
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode("expense")}>Add expense</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode("bill")}>Add bill</button>
          </div>
        )}
      </div>
      <p className="hint">
        Paid from the family pool ({formatUsd(bal(accounts.pool.USD))} · {formatMoney(bal(accounts.pool.LBP), "LBP")}). They count toward the family budget, not anyone's personal limit.
      </p>

      {mode === "expense" && (
        <ExpenseForm familyId={familyId} members={members} categories={categories} defaultRate={rate} onDone={done} onCancel={() => setMode(null)} />
      )}
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
        {bills.map((b) => {
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
              {paying?.id === b.id && <PayForm bill={b} defaultRate={rate} onDone={done} onCancel={() => setPaying(null)} />}
            </li>
          );
        })}
      </ul>

      <h3 className="subsection">Recent</h3>
      {expenses.length === 0 && <p className="hint">Nothing recorded yet.</p>}
      <ul className="txn-list">
        {expenses.slice(0, 10).map((e) => (
          <li key={e.id}>
            <div>
              <span className="txn-amount">
                {formatUsd(-e.net_usd)}
                {e.currency !== "USD" && <span className="txn-converted"> ({formatMoney(e.amount, e.currency)})</span>}
              </span>
              <span className="txn-meta">
                {e.title}{catName(e.category_id) ? ` · ${catName(e.category_id)}` : ""}{e.tagged_member_id ? ` · for ${name(e.tagged_member_id) ?? "a member"}` : ""} · {formatDateTime(e.created_at)}
              </span>
            </div>
            {e.note && <p className="txn-note">{e.note}</p>}
            {amAdmin && (
              <div className="txn-actions">
                <button type="button" className="remove-btn" onClick={() => remove(e)}>Delete</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="status error">{error}</p>}
    </section>
  );
}

function ExpenseForm({ familyId, members, categories, defaultRate, onDone, onCancel }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState(defaultRate);
  const [categoryId, setCategoryId] = useState("");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    if (currency === "LBP" && !(parseNumber(rate) > 0)) return setError("Enter the exchange rate (LBP per $1).");
    setBusy(true);
    setError(null);
    try {
      await createCommonExpense({
        familyId, title, amount: n, currency, categoryId, note, taggedMemberId: tag,
        lbpPerUsd: currency === "LBP" ? parseNumber(rate) : null,
        createdAt: when ? new Date(when).toISOString() : null,
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="form-stack group" style={{ marginBottom: 12 }}>
      <h4>New common expense</h4>
      <TextInput label="What for" value={title} onChange={setTitle} placeholder="Electricity, water, tuition..." required />
      <datalist id="common-suggestions">{SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
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
        <SelectInput label="For (optional)" value={tag} onChange={setTag} help="For example the student a tuition fee belongs to">
          <option value="">The whole family</option>
          {members.map((m) => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
        </SelectInput>
      </div>
      <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} help="Leave empty for now" />
      <TextInput label="Note" value={note} onChange={setNote} placeholder="Optional" />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Saving..." : "Record expense"}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="status error">{error}</p>}
    </form>
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
function PayForm({ bill, defaultRate, onDone, onCancel }) {
  const [amount, setAmount] = useState(String(bill.amount));
  const [rate, setRate] = useState(defaultRate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    setBusy(true);
    setError(null);
    try {
      await payCommonBill({ billId: bill.id, amount: n, lbpPerUsd: bill.currency === "LBP" ? parseNumber(rate) : null });
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
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Paying..." : "Pay from pool"}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
