import { useState } from "react";
import { createTransfer, fmtMoney } from "../lib/wallets";

// Moves money between the family pool and the caller's own wallet, in either
// direction. direction="in": pool -> my wallet. direction="out": my wallet -> pool.
export default function MoveMoneyForm({ direction, memberId, accounts, onDone }) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const mine = accounts.members[memberId] || {};
  const pool = accounts.pool;
  const from = direction === "in" ? pool[currency] : mine[currency];
  const to = direction === "in" ? mine[currency] : pool[currency];

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createTransfer({ from: from.id, to: to.id, amount: parseFloat(amount) });
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
        {direction === "in" ? "Family pool" : "My wallet"} has {fmtMoney(from?.balance_cache, currency)}
      </p>
      <input type="number" step="any" min="0" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
        <option value="USD">USD</option>
        <option value="LBP">LBP</option>
      </select>
      <button type="submit" disabled={busy || !from || !to}>
        {busy ? "Moving..." : direction === "in" ? "Add to My Wallet" : "Return to Family Pool"}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
