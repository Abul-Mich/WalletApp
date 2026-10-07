import { useState } from "react";
import { createTransfer } from "../lib/wallets";
import { formatMoney, parseNumber } from "../lib/format";
import { MoneyInput, SelectInput } from "../components/Field";

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
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    setBusy(true);
    setError(null);
    try {
      await createTransfer({ from: from.id, to: to.id, amount: n });
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
      <p className="hint">
        {direction === "in" ? "Family pool" : "Your wallet"} has {formatMoney(from?.balance_cache, currency)}
      </p>
      <div className="grid">
        <MoneyInput label="Amount" unit={currency} value={amount} onChange={setAmount} placeholder="0" required autoFocus />
        <SelectInput label="Currency" value={currency} onChange={setCurrency}>
          <option value="USD">US dollars (USD)</option>
          <option value="LBP">Lebanese pounds (LBP)</option>
        </SelectInput>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !from || !to}>
        {busy ? "Moving..." : direction === "in" ? "Take from pool" : "Return to pool"}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
