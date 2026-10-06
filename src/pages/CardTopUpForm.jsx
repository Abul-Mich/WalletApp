import { useState } from "react";
import { createTransfer, fmtMoney } from "../lib/wallets";

// Moves money from the family pool onto a shared prepaid card (same currency
// as the card). Any member can do this; the database refuses if the pool
// does not have enough.
export default function CardTopUpForm({ cardAccount, poolAccounts, members, onDone }) {
  const [tag, setTag] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = cardAccount.currency;
  const pool = poolAccounts?.[cur];

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createTransfer({ from: pool.id, to: cardAccount.id, amount: parseFloat(amount), taggedMemberId: tag || null });
      setAmount("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inline-form">
      <p className="hint">
        Family pool: {fmtMoney(pool?.balance_cache, cur)} · this card holds {cur}
      </p>
      <input type="number" step="any" min="0" placeholder={`Amount (${cur})`} value={amount} onChange={(e) => setAmount(e.target.value)} required />
      <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag a family member (optional)">
        <option value="">No tag (optional)</option>
        {(members || []).map((m) => (<option key={m.id} value={m.id}>For {m.display_name}</option>))}
      </select>
      <button type="submit" disabled={busy || !pool}>{busy ? "Adding..." : "Top Up Card"}</button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
