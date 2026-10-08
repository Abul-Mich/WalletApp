import { useState } from "react";
import { createTransfer } from "../lib/wallets";
import { formatMoney, parseNumber } from "../lib/format";
import { MoneyInput, SelectInput, TextInput } from "../components/Field";

function nowLocalInput() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Moves money onto a shared prepaid card (same currency as the card) from the family pool
// or from a member's own wallet. Members can use the pool or their own wallet; admins can
// also use another member's wallet. The database refuses if the source does not have enough.
// The "For" tag is an optional label with no effect on limits.
export default function CardTopUpForm({ cardAccount, poolAccounts, memberAccounts, memberId, amAdmin, members, onDone }) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("pool");
  const [tag, setTag] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const cur = cardAccount.currency;

  // Where the money can come from, in this card's currency.
  const options = [];
  if (poolAccounts?.[cur]) options.push({ key: "pool", label: "Family pool", acct: poolAccounts[cur] });
  const mine = memberAccounts?.[memberId]?.[cur];
  if (mine) options.push({ key: `m:${memberId}`, label: "My wallet", acct: mine });
  if (amAdmin) {
    for (const m of members || []) {
      const a = memberAccounts?.[m.id]?.[cur];
      if (a && m.id !== memberId) options.push({ key: `m:${m.id}`, label: `${m.display_name}'s wallet`, acct: a });
    }
  }
  const chosen = options.find((o) => o.key === source) || options[0];

  async function handleSubmit(e) {
    e.preventDefault();
    const n = parseNumber(amount);
    if (!(n > 0)) return setError("Enter an amount.");
    if (when && new Date(when) > new Date()) return setError("The date cannot be in the future.");
    if (!chosen) return setError("No wallet to take the money from.");
    setBusy(true);
    setError(null);
    try {
      await createTransfer({
        from: chosen.acct.id, to: cardAccount.id, amount: n, taggedMemberId: tag || null,
        createdAt: when ? new Date(when).toISOString() : null,
      });
      setAmount("");
      setWhen("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-stack">
      <p className="hint">This card holds {cur}.</p>
      <SelectInput
        label="Take from" value={chosen?.key ?? ""} onChange={setSource}
        help={chosen ? `Available: ${formatMoney(chosen.acct.balance_cache, cur)}` : undefined}
      >
        {options.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
      </SelectInput>
      <MoneyInput label="Amount" unit={cur} value={amount} onChange={setAmount} placeholder="0" required autoFocus />
      <SelectInput label="For (optional)" value={tag} onChange={setTag} help="A label only. It does not change anyone's limit.">
        <option value="">No one in particular</option>
        {(members || []).map((m) => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
      </SelectInput>
      <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} max={nowLocalInput()} help="Leave empty for now" />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !chosen}>
        {busy ? "Adding..." : "Top up card"}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
