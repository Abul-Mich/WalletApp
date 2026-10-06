import { useEffect, useState } from "react";
import { createDeposit, latestLbpRate } from "../lib/wallets";

// Admin only: add money to the family pool in USD or LBP.
export default function DepositForm({ familyId, accounts, onDone }) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    latestLbpRate(familyId).then((r) => r && setRate(String(r)));
  }, [familyId]);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createDeposit({
        accountId: accounts.pool[currency].id,
        amount: parseFloat(amount),
        lbpPerUsd: currency === "LBP" ? parseFloat(rate) : null,
      });
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
      <input type="number" step="any" min="0" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
        <option value="USD">USD</option>
        <option value="LBP">LBP</option>
      </select>
      {currency === "LBP" && (
        <input type="number" step="any" min="0" placeholder="LBP per 1 USD" value={rate} onChange={(e) => setRate(e.target.value)} required />
      )}
      <button type="submit" disabled={busy}>{busy ? "Adding..." : "Add Funds"}</button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
