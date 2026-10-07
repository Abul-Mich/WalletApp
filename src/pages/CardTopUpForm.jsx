import { useState } from "react";
import { createTransfer } from "../lib/wallets";
import { formatMoney, parseNumber } from "../lib/format";
import { MoneyInput, SelectInput } from "../components/Field";

// Moves money from the family pool onto a shared prepaid card (same currency
// as the card). Any member can do this; the database refuses if the pool
// does not have enough. The tag is an optional label with no effect on limits.
export default function CardTopUpForm({ cardAccount, poolAccounts, members, onDone }) {
  const [amount, setAmount] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = cardAccount.currency;
  const pool = poolAccounts?.[cur];

  async function handleSubmit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    setBusy(true);
    setError(null);
    try {
      await createTransfer({ from: pool.id, to: cardAccount.id, amount: n, taggedMemberId: tag || null });
      setAmount("");
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
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !pool}>
        {busy ? "Adding..." : "Top up card"}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
