import { useEffect, useState } from "react";
import { createCardSpend, latestLbpRate } from "../lib/wallets";
import { formatMoney, formatRate, parseNumber } from "../lib/format";
import { MoneyInput, SelectInput, TextInput } from "../components/Field";

// Spending from a shared prepaid card. The card holds one currency; spending
// counts toward the limits of the member it is tagged for, in USD.
export default function CardWithdrawForm({ familyId, memberId, members, card, cardAccount, onDone }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [tag, setTag] = useState(memberId || "");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = cardAccount.currency;
  const balance = Number(cardAccount.balance_cache || 0);

  useEffect(() => {
    if (cur === "LBP") latestLbpRate(familyId).then((r) => r && setRate(String(r)));
  }, [familyId, cur]);

  async function handleSubmit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    setBusy(true);
    setError(null);
    try {
      await createCardSpend({
        cardId: card.id, amount: n, note, taggedMemberId: tag,
        lbpPerUsd: cur === "LBP" ? parseNumber(rate) : null,
      });
      setAmount("");
      setNote("");
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
      <SelectInput label="Spent for" value={tag} onChange={setTag} required help="Counts toward this person's limit.">
        {(members || []).map((m) => (
          <option key={m.id} value={m.id}>{m.display_name}{m.id === memberId ? " (me)" : ""}</option>
        ))}
      </SelectInput>
      <TextInput label="Note" value={note} onChange={setNote} placeholder="Optional" />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || balance <= 0}>
        {busy ? "Saving..." : "Spend from card"}
      </button>
      {balance <= 0 && !error && <p className="hint">This card is empty.</p>}
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
