import { useEffect, useState } from "react";
import { createCardSpend, latestLbpRate, fmtMoney } from "../lib/wallets";

// Spending from a shared prepaid card. The card holds one currency; spending
// counts toward the spender's limits in USD.
export default function CardWithdrawForm({ familyId, memberId, members, card, cardAccount, onDone }) {
  const [tag, setTag] = useState(memberId || "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
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
    setBusy(true);
    setError(null);
    try {
      await createCardSpend({
        cardId: card.id,
        amount: parseFloat(amount),
        note,
        taggedMemberId: tag,
        lbpPerUsd: cur === "LBP" ? parseFloat(rate) : null,
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
    <form onSubmit={handleSubmit} className="inline-form">
      <p className="hint">Card balance: {fmtMoney(balance, cur)}</p>
      <input type="number" step="any" min="0" placeholder={`Amount (${cur})`} value={amount} onChange={(e) => setAmount(e.target.value)} required />
      {cur === "LBP" && (
        <input type="number" step="any" min="0" placeholder="LBP per 1 USD" value={rate} onChange={(e) => setRate(e.target.value)} required />
      )}
      <select value={tag} onChange={(e) => setTag(e.target.value)} required aria-label="Spent for">
        {(members || []).map((m) => (<option key={m.id} value={m.id}>For {m.display_name}{m.id === memberId ? " (me)" : ""}</option>))}
      </select>
      <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="submit" disabled={busy || balance <= 0}>{busy ? "Logging..." : "Spend from Card"}</button>
      {balance <= 0 && !error && <p className="hint">This card is empty.</p>}
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
