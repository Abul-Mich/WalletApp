import { useState } from "react";
import { createTransfer } from "../lib/wallets";
import { formatMoney, parseNumber } from "../lib/format";
import { MoneyInput, SelectInput, TextInput } from "../components/Field";

function nowLocalInput() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Moves money from the family pool onto a shared prepaid card (same currency
// as the card). Any member can do this; the database refuses if the pool
// does not have enough. The tag is an optional label with no effect on limits.
export default function CardTopUpForm({ cardAccount, poolAccounts, members, onDone }) {
  const [amount, setAmount] = useState("");
  const [tag, setTag] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = cardAccount.currency;
  const pool = poolAccounts?.[cur];

  async function handleSubmit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    if (when && new Date(when) > new Date()) return setError("The date cannot be in the future.");
    setBusy(true);
    setError(null);
    try {
      await createTransfer({ from: pool.id, to: cardAccount.id, amount: n, taggedMemberId: tag || null, createdAt: when ? new Date(when).toISOString() : null });
      setAmount("");
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
      <p className="hint">Family pool has {formatMoney(pool?.balance_cache, cur)}. This card holds {cur}.</p>
      <MoneyInput label="Amount" unit={cur} value={amount} onChange={setAmount} placeholder="0" required autoFocus />
      <SelectInput label="For (optional)" value={tag} onChange={setTag} help="A label only. It does not change anyone's limit.">
        <option value="">No one in particular</option>
        {(members || []).map((m) => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
      </SelectInput>
      <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} max={nowLocalInput()} help="Leave empty for now" />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !pool}>
        {busy ? "Adding..." : "Top up card"}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
