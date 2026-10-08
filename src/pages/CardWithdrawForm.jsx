import { useEffect, useState } from "react";
import { createCardSpend, createCommonExpense, latestLbpRate } from "../lib/wallets";
import { formatMoney, formatRate, parseNumber } from "../lib/format";
import { MoneyInput, SelectInput, TextInput } from "../components/Field";

// "now" as a value for a datetime-local input's max (no future dates).
function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Spending from a shared prepaid card. The card holds one currency.
// Normal spend: counts toward the limit of the member it is tagged for.
// Family cost (admins): recorded as a common expense paid from this card; counts toward the
// family budget only, never a personal limit.
export default function CardWithdrawForm({ familyId, memberId, members, categories, amAdmin, card, cardAccount, onDone }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [tag, setTag] = useState(memberId || "");
  const [family, setFamily] = useState(false);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [when, setWhen] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = cardAccount.currency;
  const balance = Number(cardAccount.balance_cache || 0);

  useEffect(() => {
    if (cur === "LBP") latestLbpRate(familyId).then((r) => r && setRate(String(r)));
  }, [familyId, cur]);

  function toggleFamily(on) {
    setFamily(on);
    setTag(on ? "" : memberId || "");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    if (when && new Date(when) > new Date()) return setError("The date cannot be in the future.");
    if (family && !title.trim()) return setError("Enter what it was for.");
    const lbpPerUsd = cur === "LBP" ? parseNumber(rate) : null;
    const createdAt = when ? new Date(when).toISOString() : null;
    setBusy(true);
    setError(null);
    try {
      if (family) {
        await createCommonExpense({
          familyId, title, amount: n, currency: cur, categoryId, note, lbpPerUsd,
          taggedMemberId: tag || null, createdAt, accountId: cardAccount.id,
        });
      } else {
        await createCardSpend({ cardId: card.id, amount: n, note, taggedMemberId: tag, lbpPerUsd, createdAt });
      }
      setAmount("");
      setNote("");
      setTitle("");
      setWhen("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-stack">
      <p className="hint">Card balance: {formatMoney(balance, cur)}</p>
      <MoneyInput label="Amount" unit={cur} value={amount} onChange={setAmount} placeholder="0" required autoFocus />
      {cur === "LBP" && (
        <MoneyInput
          label="Exchange rate" unit="LBP/USD" value={rate} onChange={setRate} placeholder="89,500" required
          help={parseNumber(rate) > 0 ? formatRate(parseNumber(rate)) : "How many LBP equal $1 today"}
        />
      )}

      {amAdmin && (
        <label className="check-row">
          <input type="checkbox" checked={family} onChange={(e) => toggleFamily(e.target.checked)} />
          <span>Family cost <span className="hint">(doesn't count toward anyone's limit)</span></span>
        </label>
      )}

      {family && (
        <>
          <TextInput label="What for" value={title} onChange={setTitle} placeholder="Tuition, electricity..." required />
          <SelectInput label="Category" value={categoryId} onChange={setCategoryId}>
            <option value="">No category</option>
            {(categories || []).map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </SelectInput>
        </>
      )}

      <SelectInput
        label={family ? "For (optional)" : "Spent for"} value={tag} onChange={setTag} required={!family}
        help={family ? "A label only, for example the student a tuition fee belongs to." : "Counts toward this person's limit."}
      >
        {family && <option value="">The whole family</option>}
        {(members || []).map((m) => (
          <option key={m.id} value={m.id}>{m.display_name}{m.id === memberId ? " (me)" : ""}</option>
        ))}
      </SelectInput>

      <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} max={nowLocal()} help="Leave empty for now" />
      <TextInput label="Note" value={note} onChange={setNote} placeholder="Optional" />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || balance <= 0}>
        {busy ? "Saving..." : family ? "Record family cost" : "Spend from card"}
      </button>
      {balance <= 0 && !error && <p className="hint">This card is empty.</p>}
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
