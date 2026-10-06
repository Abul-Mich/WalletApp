import { useEffect, useMemo, useState } from "react";
import {
  buildLegs,
  netUsd,
  createExpense,
  latestLbpRate,
  bal,
} from "../lib/wallets";

// Expense form for the two-wallet ledger.
// Quick path: one amount in one currency.
// Split view: paid in USD and/or LBP, with change back in USD and/or LBP.
export default function TransactionForm({
  familyId,
  memberId,
  categories,
  accounts, // { USD: accountRow, LBP: accountRow } for the spending member
  onDone,
}) {
  const [split, setSplit] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [paidUsd, setPaidUsd] = useState("");
  const [paidLbp, setPaidLbp] = useState("");
  const [changeUsd, setChangeUsd] = useState("");
  const [changeLbp, setChangeLbp] = useState("");
  const [rate, setRate] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    latestLbpRate(familyId).then((r) => r && setRate(String(r)));
  }, [familyId]);

  const legs = useMemo(() => {
    if (!split) {
      const n = parseFloat(amount) || 0;
      return currency === "USD"
        ? buildLegs({ paidUsd: n })
        : buildLegs({ paidLbp: n });
    }
    return buildLegs({
      paidUsd: parseFloat(paidUsd) || 0,
      paidLbp: parseFloat(paidLbp) || 0,
      changeUsd: parseFloat(changeUsd) || 0,
      changeLbp: parseFloat(changeLbp) || 0,
    });
  }, [split, currency, amount, paidUsd, paidLbp, changeUsd, changeLbp]);

  const usesLbp = legs.some((l) => l.currency === "LBP");
  const rateNum = parseFloat(rate) || 0;
  const net = usesLbp && !rateNum ? null : netUsd(legs, rateNum);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (legs.length === 0) return setError("Enter an amount.");
    if (usesLbp && !rateNum) return setError("Enter the LBP rate.");
    if (net !== null && net <= 0)
      return setError("The net spend must be greater than zero.");
    setBusy(true);
    try {
      // Original amount/currency are kept for display of what was typed.
      const first = legs.find((l) => l.amount < 0);
      await createExpense({
        memberId,
        categoryId,
        note,
        legs,
        lbpPerUsd: usesLbp ? rateNum : null,
        createdAt: when ? new Date(when).toISOString() : null,
        originalAmount: first ? Math.abs(first.amount) : null,
        originalCurrency: first ? first.currency : null,
      });
      setAmount("");
      setPaidUsd("");
      setPaidLbp("");
      setChangeUsd("");
      setChangeLbp("");
      setNote("");
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
        Your wallets: {bal(accounts?.USD).toFixed(2)} USD ·{" "}
        {bal(accounts?.LBP).toLocaleString()} LBP
      </p>

      {!split ? (
        <>
          <input
            type="number"
            step="any"
            min="0"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD</option>
            <option value="LBP">LBP</option>
          </select>
        </>
      ) : (
        <>
          <input type="number" step="any" min="0" placeholder="Paid USD" value={paidUsd} onChange={(e) => setPaidUsd(e.target.value)} />
          <input type="number" step="any" min="0" placeholder="Paid LBP" value={paidLbp} onChange={(e) => setPaidLbp(e.target.value)} />
          <input type="number" step="any" min="0" placeholder="Change USD" value={changeUsd} onChange={(e) => setChangeUsd(e.target.value)} />
          <input type="number" step="any" min="0" placeholder="Change LBP" value={changeLbp} onChange={(e) => setChangeLbp(e.target.value)} />
        </>
      )}

      <button type="button" className="link-button" onClick={() => setSplit((s) => !s)}>
        {split ? "Single amount" : "Paid in two currencies / got change"}
      </button>

      {usesLbp && (
        <input
          type="number"
          step="any"
          min="0"
          placeholder="LBP per 1 USD"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          required
        />
      )}

      {net !== null && legs.length > 0 && (
        <p className="hint">Net spend: {net.toFixed(2)} USD</p>
      )}

      <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      <button type="submit" disabled={busy}>
        {busy ? "Logging..." : "Log Expense"}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
