import { useState } from "react";
import { supabase } from "../supabaseClient";
import {
  buildLegs, netUsd, updateExpense, deleteExpense, deleteCardSpend,
  fmtMoney, fmtWhen,
} from "../lib/wallets";

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// One expense or card-spend row. Amounts are shown as net USD (the number
// that counts toward limits) with the original currency beside it.
export default function TransactionRow({ t, categories, members, canManage, onChanged }) {
  const isCard = t.kind === "card";
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const categoryName = isCard
    ? "Card spending"
    : categories?.find((c) => c.id === t.category_id)?.name ?? "Uncategorized";
  const memberName = members?.find((m) => m.id === t.member_id)?.display_name ?? "Unknown member";
  const net = t.net_usd != null ? Number(t.net_usd) : Number(t.amount) * Number(t.exchange_rate_to_base);

  async function startEdit() {
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = await supabase
        .from("transaction_legs")
        .select("amount, wallet_accounts(currency)")
        .eq("transaction_id", t.id);
      if (err) throw err;
      const sum = { paidUsd: 0, paidLbp: 0, changeUsd: 0, changeLbp: 0 };
      for (const l of data || []) {
        const cur = l.wallet_accounts?.currency;
        const a = Number(l.amount);
        if (cur === "USD") a < 0 ? (sum.paidUsd += -a) : (sum.changeUsd += a);
        else a < 0 ? (sum.paidLbp += -a) : (sum.changeLbp += a);
      }
      setF({
        paidUsd: sum.paidUsd ? String(sum.paidUsd) : "",
        paidLbp: sum.paidLbp ? String(sum.paidLbp) : "",
        changeUsd: sum.changeUsd ? String(sum.changeUsd) : "",
        changeLbp: sum.changeLbp ? String(sum.changeLbp) : "",
        rate: t.lbp_per_usd ? String(t.lbp_per_usd) : "",
        categoryId: t.category_id ?? "",
        note: t.note ?? "",
        when: toLocalInput(t.created_at),
      });
      setEditing(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const legs = buildLegs({
        paidUsd: parseFloat(f.paidUsd) || 0,
        paidLbp: parseFloat(f.paidLbp) || 0,
        changeUsd: parseFloat(f.changeUsd) || 0,
        changeLbp: parseFloat(f.changeLbp) || 0,
      });
      const usesLbp = legs.some((l) => l.currency === "LBP");
      const rate = parseFloat(f.rate) || 0;
      if (legs.length === 0) throw new Error("Enter an amount.");
      if (usesLbp && !rate) throw new Error("Enter the LBP rate.");
      if (netUsd(legs, rate) <= 0) throw new Error("The net spend must be greater than zero.");
      const first = legs.find((l) => l.amount < 0);
      await updateExpense({
        id: t.id,
        categoryId: f.categoryId,
        note: f.note,
        legs,
        lbpPerUsd: usesLbp ? rate : null,
        createdAt: f.when ? new Date(f.when).toISOString() : null,
        originalAmount: first ? Math.abs(first.amount) : null,
        originalCurrency: first ? first.currency : null,
      });
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete this ${isCard ? "card spending" : "expense"}? The money goes back to the wallet it came from.`)) return;
    setBusy(true);
    setError(null);
    try {
      if (isCard) await deleteCardSpend(t.id);
      else await deleteExpense(t.id);
      onChanged?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (editing && f) {
    return (
      <li className="txn-edit">
        <div className="inline-form">
          <input type="number" step="any" min="0" placeholder="Paid USD" value={f.paidUsd} onChange={set("paidUsd")} />
          <input type="number" step="any" min="0" placeholder="Paid LBP" value={f.paidLbp} onChange={set("paidLbp")} />
          <input type="number" step="any" min="0" placeholder="Change USD" value={f.changeUsd} onChange={set("changeUsd")} />
          <input type="number" step="any" min="0" placeholder="Change LBP" value={f.changeLbp} onChange={set("changeLbp")} />
          <input type="number" step="any" min="0" placeholder="LBP per 1 USD" value={f.rate} onChange={set("rate")} />
          <select value={f.categoryId} onChange={set("categoryId")}>
            {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <input placeholder="Note" value={f.note} onChange={set("note")} />
          <input type="datetime-local" value={f.when} onChange={set("when")} />
          <button type="button" disabled={busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>
          <button type="button" className="remove-btn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
        </div>
        {error && <p className="status error">{error}</p>}
      </li>
    );
  }

  return (
    <li>
      <div>
        <span className="txn-amount">
          -{net.toFixed(2)} USD
          {t.currency && t.currency !== "USD" && (
            <span className="txn-converted"> ({fmtMoney(t.amount, t.currency)})</span>
          )}
        </span>
        <span className="txn-meta">{categoryName} · {memberName} · {fmtWhen(t.created_at)}</span>
      </div>
      {t.note && <p className="txn-note">{t.note}</p>}
      {canManage && (
        <div className="txn-actions">
          {!isCard && <button type="button" disabled={busy} onClick={startEdit}>Edit</button>}
          <button type="button" className="remove-btn" disabled={busy} onClick={remove}>Delete</button>
        </div>
      )}
      {error && <p className="status error">{error}</p>}
    </li>
  );
}
