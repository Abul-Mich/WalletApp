import { useEffect, useMemo, useState } from "react";
import { buildLegs, netUsd, createExpense, latestLbpRate, bal } from "../lib/wallets";
import { formatUsd, formatLbp, formatRate, parseNumber } from "../lib/format";
import { MoneyInput, TextInput, SelectInput, FormGroup, Field } from "../components/Field";

const num = (v) => {
  const n = parseNumber(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Expense form for the two-wallet ledger.
// Quick path: one amount in one currency.
// Split view: paid in USD and/or LBP, with change back in USD and/or LBP.
export default function TransactionForm({ familyId, memberId, categories, accounts, onDone }) {
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
      const n = num(amount);
      return currency === "USD" ? buildLegs({ paidUsd: n }) : buildLegs({ paidLbp: n });
    }
    return buildLegs({
      paidUsd: num(paidUsd), paidLbp: num(paidLbp),
      changeUsd: num(changeUsd), changeLbp: num(changeLbp),
    });
  }, [split, currency, amount, paidUsd, paidLbp, changeUsd, changeLbp]);

  const usesLbp = legs.some((l) => l.currency === "LBP");
  const rateNum = num(rate);
  const net = usesLbp && !rateNum ? null : netUsd(legs, rateNum);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (legs.length === 0) return setError("Enter an amount.");
    if (usesLbp && !rateNum) return setError("Enter the exchange rate (LBP per $1).");
    if (net !== null && net <= 0) return setError("The net spend must be greater than zero.");
    setBusy(true);
    try {
      const first = legs.find((l) => l.amount < 0);
      await createExpense({
        memberId, categoryId, note, legs,
        lbpPerUsd: usesLbp ? rateNum : null,
        createdAt: when ? new Date(when).toISOString() : null,
        originalAmount: first ? Math.abs(first.amount) : null,
        originalCurrency: first ? first.currency : null,
      });
      setAmount(""); setPaidUsd(""); setPaidLbp(""); setChangeUsd(""); setChangeLbp(""); setNote("");
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
        Your wallets: {formatUsd(bal(accounts?.USD))} · {formatLbp(bal(accounts?.LBP))}
      </p>

      {!split ? (
        <div className="grid">
          <MoneyInput label="Amount" unit={currency} value={amount} onChange={setAmount} placeholder="0" required autoFocus />
          <SelectInput label="Currency" value={currency} onChange={setCurrency}>
            <option value="USD">US dollars (USD)</option>
            <option value="LBP">Lebanese pounds (LBP)</option>
          </SelectInput>
        </div>
      ) : (
        <>
          <FormGroup title="You paid">
            <MoneyInput label="US dollars" unit="USD" value={paidUsd} onChange={setPaidUsd} placeholder="0" />
            <MoneyInput label="Lebanese pounds" unit="LBP" value={paidLbp} onChange={setPaidLbp} placeholder="0" />
          </FormGroup>
          <FormGroup title="Change you got back">
            <MoneyInput label="US dollars" unit="USD" value={changeUsd} onChange={setChangeUsd} placeholder="0" />
            <MoneyInput label="Lebanese pounds" unit="LBP" value={changeLbp} onChange={setChangeLbp} placeholder="0" />
          </FormGroup>
        </>
      )}

      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setSplit((s) => !s)}>
        {split ? "Use a single amount" : "Paid in two currencies or got change?"}
      </button>

      {usesLbp && (
        <MoneyInput
          label="Exchange rate" unit="LBP/USD" value={rate} onChange={setRate} placeholder="89,500" required
          help={rateNum ? formatRate(rateNum) : "How many LBP equal $1 today"}
        />
      )}

      {legs.length > 0 && net !== null && (
        <div className="net-line"><span>Net spent</span><strong>{formatUsd(net)}</strong></div>
      )}

      <div className="grid">
        <SelectInput label="Category" value={categoryId} onChange={setCategoryId}>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </SelectInput>
        <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} help="Leave empty for now" />
      </div>
      <TextInput label="Note" value={note} onChange={setNote} placeholder="Optional" />

      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? "Saving..." : "Log expense"}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
