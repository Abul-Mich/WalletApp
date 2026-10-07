import { useEffect, useState } from "react";
import { createDeposit, latestLbpRate } from "../lib/wallets";
import { formatRate, parseNumber } from "../lib/format";
import { MoneyInput, SelectInput } from "../components/Field";

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
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    setBusy(true);
    setError(null);
    try {
      await createDeposit({
        accountId: accounts.pool[currency].id,
        amount: n,
        lbpPerUsd: currency === "LBP" ? parseNumber(rate) : null,
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
    <form onSubmit={handleSubmit} className="form-stack">
      <div className="grid">
        <MoneyInput label="Amount" unit={currency} value={amount} onChange={setAmount} placeholder="0" required />
        <SelectInput label="Currency" value={currency} onChange={setCurrency}>
          <option value="USD">US dollars (USD)</option>
          <option value="LBP">Lebanese pounds (LBP)</option>
        </SelectInput>
      </div>
      {currency === "LBP" && (
        <MoneyInput
          label="Exchange rate" unit="LBP/USD" value={rate} onChange={setRate} placeholder="89,500" required
          help={parseNumber(rate) > 0 ? formatRate(parseNumber(rate)) : "How many LBP equal $1 today"}
        />
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Adding..." : "Add funds"}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
