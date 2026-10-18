import { useState } from "react";
import { updateCardSpend } from "../lib/wallets";
import { formatMoney, formatUsd, formatRate, parseNumber } from "../lib/format";
import { MoneyInput } from "../components/Field";
import AmountHero from "../components/AmountHero";
import { CategoryChips, PersonChips, DateNote, ImpactCard, EditSheet, signed } from "../components/RecordFields";

function toLocalInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const num = (v) => {
  const n = parseNumber(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Edit a card spend: amount, category, who it is for, date and note. The card itself cannot change.
export default function CardSpendEditForm({ record, categories, members, cardName, onSaved, onCancel, onDelete }) {
  const currency = record.currency;
  const oldNet = Math.abs(Number(record.net_usd));
  const oldAmount = Number(record.amount);
  const oldRate = currency === "LBP" && oldNet > 0 ? Math.round(oldAmount / oldNet) : null;
  const oldTag = record.tagged_member_id ?? record.member_id ?? "";
  const oldWhen = toLocalInput(record.created_at);
  const [amount, setAmount] = useState(String(oldAmount));
  const [rate, setRate] = useState(oldRate ? String(oldRate) : "");
  const [categoryId, setCategoryId] = useState(record.category_id ?? "");
  const [tag, setTag] = useState(oldTag);
  const [when, setWhen] = useState(oldWhen);
  const [note, setNote] = useState(record.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const people = (members || []).filter((m) => !m.removed_at || m.id === tag);
  const nameOf = (id) => members?.find((m) => m.id === id)?.display_name ?? "Someone";
  const n = num(amount);
  const rateNum = num(rate);
  const newNet = currency === "USD" ? n : rateNum ? n / rateNum : 0;
  const changed =
    Math.abs(n - oldAmount) > 1e-9 || (currency === "LBP" && Math.abs(rateNum - (oldRate || 0)) > 0.5) ||
    categoryId !== (record.category_id ?? "") || tag !== oldTag || when !== oldWhen || note !== (record.note ?? "");

  const rows = [];
  if (n > 0 && (Math.abs(n - oldAmount) > 1e-9 || (currency === "LBP" && rateNum !== oldRate))) {
    rows.push({ name: `${cardName || "Card"} balance`, value: signed(oldAmount - n, (v) => formatMoney(v, currency)) });
  }
  if (tag === oldTag && newNet > 0 && Math.abs(newNet - oldNet) > 0.004) {
    rows.push({ name: `${nameOf(tag)}'s limit usage`, value: signed(newNet - oldNet, formatUsd) });
  } else if (tag !== oldTag) {
    rows.push({ name: `${nameOf(oldTag)}'s limit usage`, value: `−${formatUsd(oldNet)}` });
    rows.push({ name: `${nameOf(tag)}'s limit usage`, value: `+${formatUsd(newNet)}` });
  }

  async function save(e) {
    e.preventDefault();
    if (!(n > 0)) return setError("Enter an amount.");
    if (currency === "LBP" && !(rateNum > 0)) return setError("Enter the exchange rate (LBP per $1).");
    if (when && new Date(when) > new Date()) return setError("The date cannot be in the future.");
    setBusy(true);
    setError(null);
    try {
      await updateCardSpend({
        id: record.id, amount: n, note, categoryId, taggedMemberId: tag,
        lbpPerUsd: currency === "LBP" ? rateNum : null,
        createdAt: when ? new Date(when).toISOString() : null,
      });
      onSaved?.();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <EditSheet title="Edit expense" onClose={busy ? undefined : onCancel}>
      <form onSubmit={save} className="spend-form">
        <div className="sf-scroll">
          <AmountHero value={amount} onChange={setAmount} currency={currency} autoFocus={false}>
            {Math.abs(n - oldAmount) > 1e-9 && <span className="sf-muted sf-small">Was {formatMoney(oldAmount, currency)}</span>}
          </AmountHero>

          {currency === "LBP" && (
            <MoneyInput label="Exchange rate (LBP per $1)" value={rate} onChange={setRate} placeholder="89,500" required
              help={rateNum ? `${formatRate(rateNum)} · the rate recorded with this expense` : "How many LBP equal $1"} />
          )}

          <div className="sf-block">
            <span className="sf-label">Paid from</span>
            <div className="sf-boxes">
              <div className="sf-box on"><strong>{cardName || "This card"}</strong><span>Cannot be changed. Only the amount does.</span></div>
            </div>
          </div>

          <PersonChips label="For" value={tag} onChange={setTag} options={people.map((m) => ({ value: m.id, label: m.display_name }))} />
          <CategoryChips categories={categories || []} value={categoryId} onChange={setCategoryId} allowNone />
          <ImpactCard rows={rows} />
          <DateNote when={when} onWhen={setWhen} note={note} onNote={setNote} />
          {error && <p className="status error" role="alert">{error}</p>}
        </div>

        <div className="sf-footer sf-footer-stack">
          <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !changed || !(n > 0)}>
            {busy ? "Saving..." : changed ? "Save changes" : "No changes yet"}
          </button>
          {onDelete && <button type="button" className="sf-delete" disabled={busy} onClick={onDelete}>Delete this expense</button>}
        </div>
      </form>
    </EditSheet>
  );
}
