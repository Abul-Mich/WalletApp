import { useState } from "react";
import { updateCardSpend } from "../lib/wallets";
import { formatRate, parseNumber } from "../lib/format";
import { MoneyInput, TextInput, SelectInput } from "../components/Field";

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Edit a card spend: amount, category, who it is for, date and note. The card itself cannot change.
export default function CardSpendEditForm({ record, categories, members, onSaved, onCancel }) {
  const currency = record.currency;
  const oldRate = currency === "LBP" && Number(record.net_usd) > 0 ? Math.round(Number(record.amount) / Number(record.net_usd)) : null;
  const [amount, setAmount] = useState(String(Number(record.amount)));
  const [rate, setRate] = useState(oldRate ? String(oldRate) : "");
  const [categoryId, setCategoryId] = useState(record.category_id ?? "");
  const [tag, setTag] = useState(record.tagged_member_id ?? record.member_id ?? "");
  const [when, setWhen] = useState(toLocalInput(record.created_at));
  const [note, setNote] = useState(record.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const people = (members || []).filter((m) => !m.removed_at || m.id === tag);

  async function save(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    if (currency === "LBP" && !(parseNumber(rate) > 0)) return setError("Enter the exchange rate (LBP per $1).");
    setBusy(true);
    setError(null);
    try {
      await updateCardSpend({
        id: record.id, amount: n, note, categoryId, taggedMemberId: tag,
        lbpPerUsd: currency === "LBP" ? parseNumber(rate) : null,
        createdAt: when ? new Date(when).toISOString() : null,
      });
      onSaved?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="form-stack">
      <MoneyInput label="Amount" unit={currency} value={amount} onChange={setAmount} placeholder="0" required />
      {currency === "LBP" && (
        <MoneyInput label="Exchange rate" unit="LBP/USD" value={rate} onChange={setRate} placeholder="89,500" required
          help={parseNumber(rate) > 0 ? formatRate(parseNumber(rate)) : "How many LBP equal $1"} />
      )}
      <div className="grid">
        <SelectInput label="Category" value={categoryId} onChange={setCategoryId}>
          <option value="">No category</option>
          {(categories || []).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </SelectInput>
        <SelectInput label="For" value={tag} onChange={setTag}>
          {people.map((m) => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
        </SelectInput>
      </div>
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
