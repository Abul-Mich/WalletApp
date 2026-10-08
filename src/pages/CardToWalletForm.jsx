import { useState } from "react";
import { createTransfer } from "../lib/wallets";
import { formatMoney, parseNumber } from "../lib/format";
import { MoneyInput, TextInput } from "../components/Field";

function nowLocalInput() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Moves money from a shared prepaid card onto your own wallet (same currency).
// This is not spending: nothing counts toward a limit until you spend it from your wallet.
export default function CardToWalletForm({ cardAccount, memberAccounts, memberId, onDone }) {
  const [amount, setAmount] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = cardAccount.currency;
  const mine = memberAccounts?.[memberId]?.[cur];
  const balance = Number(cardAccount.balance_cache || 0);

  async function handleSubmit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    if (when && new Date(when) > new Date()) return setError("The date cannot be in the future.");
    setBusy(true);
    setError(null);
    try {
      await createTransfer({ from: cardAccount.id, to: mine.id, amount: n, createdAt: when ? new Date(when).toISOString() : null });
      setAmount("");
      setWhen("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!mine) return <p className="hint">You don't have a {cur} wallet to move this into.</p>;

  return (
    <form onSubmit={handleSubmit} className="form-stack">
      <p className="hint">
        Card balance: {formatMoney(balance, cur)}. Your {cur} wallet: {formatMoney(mine.balance_cache, cur)}.
      </p>
      <MoneyInput label="Amount" unit={cur} value={amount} onChange={setAmount} placeholder="0" required autoFocus />
      <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} max={nowLocalInput()} help="Leave empty for now" />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || balance <= 0}>
        {busy ? "Moving..." : "Move to my wallet"}
      </button>
      {balance <= 0 && !error && <p className="hint">This card is empty.</p>}
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
