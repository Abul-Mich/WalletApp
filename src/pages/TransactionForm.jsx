import { useEffect, useMemo, useState } from "react";
import {
  buildLegs, netUsd, createExpense, createCardSpend, createCommonExpense, latestLbpRate, bal,
} from "../lib/wallets";
import { formatUsd, formatLbp, formatMoney, formatRate, parseNumber } from "../lib/format";
import { MoneyInput, TextInput, SelectInput, FormGroup } from "../components/Field";

const num = (v) => {
  const n = parseNumber(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// The one place to record a spend. Three questions decide what is saved:
//   Paid from: my wallet, a card, or (admins) the family pool.
//   For:       me / another person (card only) / the whole family (admins; card or pool).
//   Category.
// Wallet + me            -> a normal expense (counts toward my limit)
// Card + a person        -> a card spend (counts toward that person's limit)
// Card or pool + family  -> a common expense (family budget only, no personal limit)
export default function TransactionForm({
  familyId, memberId, categories, accounts, cards = [], members = [], amAdmin, presetCardId, onDone,
}) {
  const myWallets = accounts?.members?.[memberId] || {};
  const cardChoices = cards
    .filter((k) => !k.archived && accounts?.cards?.[k.id])
    .map((k) => ({ card: k, acct: accounts.cards[k.id] }));

  const [paidFrom, setPaidFrom] = useState(presetCardId && accounts?.cards?.[presetCardId] ? `card:${presetCardId}` : "wallet");
  const [forWho, setForWho] = useState(""); // "" = me, a member id, or "family"
  const [split, setSplit] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [paidUsd, setPaidUsd] = useState("");
  const [paidLbp, setPaidLbp] = useState("");
  const [changeUsd, setChangeUsd] = useState("");
  const [changeLbp, setChangeLbp] = useState("");
  const [rate, setRate] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [related, setRelated] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    latestLbpRate(familyId).then((r) => r && setRate(String(r)));
  }, [familyId]);

  const isWallet = paidFrom === "wallet";
  const isPool = paidFrom === "pool";
  const cardChoice = cardChoices.find((c) => `card:${c.card.id}` === paidFrom);
  const isCard = !!cardChoice;
  const isFamily = isPool || (isCard && forWho === "family");
  const kind = isWallet ? "expense" : isPool ? "family-pool" : isFamily ? "family-card" : "card-spend";
  const cur = isCard ? cardChoice.acct.currency : currency; // currency of a single amount

  function changePaidFrom(v) {
    setPaidFrom(v);
    setForWho("");
    setSplit(false);
  }

  const legs = useMemo(() => {
    if (!isWallet) return [];
    if (!split) {
      const n = num(amount);
      return currency === "USD" ? buildLegs({ paidUsd: n }) : buildLegs({ paidLbp: n });
    }
    return buildLegs({ paidUsd: num(paidUsd), paidLbp: num(paidLbp), changeUsd: num(changeUsd), changeLbp: num(changeLbp) });
  }, [isWallet, split, currency, amount, paidUsd, paidLbp, changeUsd, changeLbp]);

  const usesLbp = isWallet ? legs.some((l) => l.currency === "LBP") : cur === "LBP";
  const rateNum = num(rate);
  const net = isWallet && !(usesLbp && !rateNum) ? netUsd(legs, rateNum) : null;

  const forName = (id) => members.find((m) => m.id === id)?.display_name;
  const limitNote = isFamily
    ? "Family cost: counts toward the family budget only, not anyone's personal limit."
    : kind === "card-spend"
    ? `Counts toward ${forWho ? forName(forWho) ?? "that person" : "your"}${forWho ? "'s" : ""} limit.`
    : "Counts toward your limit.";

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (when && new Date(when) > new Date()) return setError("The date cannot be in the future.");
    if (usesLbp && !rateNum) return setError("Enter the exchange rate (LBP per $1).");
    const createdAt = when ? new Date(when).toISOString() : null;
    const lbpPerUsd = usesLbp ? rateNum : null;
    setBusy(true);
    try {
      if (kind === "expense") {
        if (legs.length === 0) throw new Error("Enter an amount.");
        if (net !== null && net <= 0) throw new Error("The net spend must be greater than zero.");
        const first = legs.find((l) => l.amount < 0);
        await createExpense({
          memberId, categoryId, note, legs, lbpPerUsd, createdAt,
          originalAmount: first ? Math.abs(first.amount) : null,
          originalCurrency: first ? first.currency : null,
        });
      } else {
        const n = parseNumber(amount);
        if (!(n > 0)) throw new Error("Enter an amount.");
        if (kind === "card-spend") {
          await createCardSpend({ cardId: cardChoice.card.id, amount: n, note, lbpPerUsd, createdAt, taggedMemberId: forWho || memberId, categoryId });
        } else {
          if (!title.trim()) throw new Error("Enter what the family cost was for.");
          await createCommonExpense({
            familyId, title, amount: n, currency: cur, categoryId, note, lbpPerUsd, createdAt,
            taggedMemberId: related || null, accountId: isCard ? cardChoice.acct.id : null,
          });
        }
      }
      setAmount(""); setPaidUsd(""); setPaidLbp(""); setChangeUsd(""); setChangeLbp(""); setNote(""); setTitle(""); setWhen("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const balanceHint = isWallet
    ? `Your wallets: ${formatUsd(bal(myWallets.USD))} · ${formatLbp(bal(myWallets.LBP))}`
    : isCard
    ? `Card balance: ${formatMoney(bal(cardChoice.acct), cur)}`
    : `Family pool: ${formatUsd(bal(accounts?.pool?.USD))} · ${formatLbp(bal(accounts?.pool?.LBP))}`;

  const buttonLabel = busy ? "Saving..." : kind === "expense" ? "Log expense" : kind === "card-spend" ? "Spend from card" : "Record family cost";

  return (
    <form onSubmit={handleSubmit} className="form-stack">
      {(cardChoices.length > 0 || amAdmin) && (
        <SelectInput label="Paid from" value={paidFrom} onChange={changePaidFrom}>
          <option value="wallet">My wallet</option>
          {cardChoices.map(({ card }) => (<option key={card.id} value={`card:${card.id}`}>{card.name}</option>))}
          {amAdmin && <option value="pool">Family pool</option>}
        </SelectInput>
      )}
      <p className="hint">{balanceHint}</p>

      {isCard && (
        <SelectInput label="For" value={forWho} onChange={setForWho}>
          <option value="">Me</option>
          {members.filter((m) => m.id !== memberId).map((m) => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
          {amAdmin && <option value="family">The whole family</option>}
        </SelectInput>
      )}

      {isWallet && split ? (
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
      ) : (
        <div className="grid">
          <MoneyInput label="Amount" unit={cur} value={amount} onChange={setAmount} placeholder="0" required autoFocus />
          {isCard ? (
            <div />
          ) : (
            <SelectInput label="Currency" value={currency} onChange={setCurrency}>
              <option value="USD">US dollars (USD)</option>
              <option value="LBP">Lebanese pounds (LBP)</option>
            </SelectInput>
          )}
        </div>
      )}

      {isWallet && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setSplit((s) => !s)}>
          {split ? "Use a single amount" : "Paid in two currencies or got change?"}
        </button>
      )}

      {usesLbp && (
        <MoneyInput
          label="Exchange rate" unit="LBP/USD" value={rate} onChange={setRate} placeholder="89,500" required
          help={rateNum ? `${formatRate(rateNum)} · pre-filled from the last rate used; change it if today's differs` : "How many LBP equal $1 today"}
        />
      )}

      {isWallet && legs.length > 0 && net !== null && (
        <div className="net-line"><span>Net spent</span><strong>{formatUsd(net)}</strong></div>
      )}

      {isFamily && (
        <TextInput label="What for" value={title} onChange={setTitle} placeholder="Electricity, tuition, internet..." required />
      )}

      <div className="grid">
        <SelectInput label="Category" value={categoryId} onChange={setCategoryId}>
          {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          {(isFamily || isCard) && <option value="">No category</option>}
        </SelectInput>
        <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} max={nowLocal()} help="Leave empty for now" />
      </div>

      {isFamily && (
        <SelectInput label="Related person (optional)" value={related} onChange={setRelated} help="A label only, for example the student a tuition fee belongs to.">
          <option value="">No one in particular</option>
          {members.map((m) => (<option key={m.id} value={m.id}>{m.display_name}</option>))}
        </SelectInput>
      )}

      <TextInput label="Note" value={note} onChange={setNote} placeholder="Optional" />

      <p className="hint">{limitNote}</p>

      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{buttonLabel}</button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
