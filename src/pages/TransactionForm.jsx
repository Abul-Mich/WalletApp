import { useEffect, useMemo, useState } from "react";
import {
  buildLegs, netUsd, createExpense, createCardSpend, createCommonExpense, latestLbpRate, bal,
} from "../lib/wallets";
import { formatUsd, formatLbp, formatMoney, formatRate, parseNumber, convertAmountText } from "../lib/format";
import { MoneyInput, TextInput } from "../components/Field";
import { makeColorFor } from "../lib/categoryColors";

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
const CATS_SHOWN = 5;

function LimitCard({ label, spend, added, extra }) {
  if (!spend) return extra ? <div className="sf-limit"><p className="sf-limit-note">{extra}</p></div> : null;
  const total = spend.spent + added;
  const over = total > spend.limit;
  const base = Math.min(100, (spend.spent / spend.limit) * 100);
  const add = Math.max(0, Math.min(100 - base, (added / spend.limit) * 100));
  return (
    <div className="sf-limit">
      <div className="sf-limit-row">
        <span>{label}</span>
        <strong>
          {added > 0 ? `${formatUsd(spend.spent)} → ${formatUsd(total)}` : formatUsd(spend.spent)}
          <span className="sf-muted"> of {formatUsd(spend.limit)}</span>
        </strong>
      </div>
      <div className="sf-bar" aria-hidden="true">
        <div className="sf-bar-base" style={{ width: `${base}%` }} />
        <div className={`sf-bar-add ${over ? "over" : ""}`} style={{ width: `${add}%` }} />
      </div>
      {over && <p className="sf-limit-note sf-over">This puts you over the limit.</p>}
      {extra && <p className="sf-limit-note">{extra}</p>}
    </div>
  );
}

// The one place to record a spend. Three questions decide what is saved:
//   Paid from: my wallet, a card, or (admins) the family pool.
//   For:       me / another person (card only) / the whole family (admins; card or pool).
//   Category.
// Wallet + me            -> a normal expense (counts toward my limit)
// Card + a person        -> a card spend (counts toward that person's limit)
// Card or pool + family  -> a common expense (family budget only, no personal limit)
// `limits` = { me, members: {id: spend}, family } (from getMemberSpend); optional.
export default function TransactionForm({
  familyId, memberId, categories, accounts, cards = [], members = [], amAdmin, presetCardId, limits, onDone,
}) {
  const myWallets = accounts?.members?.[memberId] || {};
  const cardChoices = cards
    .filter((k) => !k.archived && accounts?.cards?.[k.id])
    .map((k) => ({ card: k, acct: accounts.cards[k.id] }));

  const [paidFrom, setPaidFrom] = useState(presetCardId && accounts?.cards?.[presetCardId] ? `card:${presetCardId}` : "wallet");
  const [forWho, setForWho] = useState(""); // "" = me, a member id, or "family"
  const [split, setSplit] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [paidUsd, setPaidUsd] = useState("");
  const [paidLbp, setPaidLbp] = useState("");
  const [changeUsd, setChangeUsd] = useState("");
  const [changeLbp, setChangeLbp] = useState("");
  const [rate, setRate] = useState("");
  const [rateIsDefault, setRateIsDefault] = useState(false);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [allCats, setAllCats] = useState(false);
  const [title, setTitle] = useState("");
  const [related, setRelated] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    latestLbpRate(familyId).then((r) => {
      if (r) { setRate(String(r)); setRateIsDefault(true); }
    });
  }, [familyId]);

  const colorFor = useMemo(() => makeColorFor(categories), [categories]);

  const isWallet = paidFrom === "wallet";
  const isPool = paidFrom === "pool";
  const cardChoice = cardChoices.find((c) => `card:${c.card.id}` === paidFrom);
  const isCard = !!cardChoice;
  const isFamily = isPool || (isCard && forWho === "family");
  const kind = isWallet ? "expense" : isPool ? "family-pool" : isFamily ? "family-card" : "card-spend";
  const cur = isCard ? cardChoice.acct.currency : currency; // currency of a single amount
  const showSplit = isWallet && split;

  // Switching USD <-> LBP keeps the value: the typed amount is converted at the rate in the form.
  function changeCurrency(c) {
    if (c === currency) return;
    setAmount(convertAmountText(amount, currency, c, rateNum));
    setCurrency(c);
  }

  function changePaidFrom(v) {
    setPaidFrom(v);
    setForWho("");
    setSplit(false);
    setShowChange(false);
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

  // The amount in USD (what limits and budgets count), and a label for the button.
  const singleAmt = num(amount);
  const usdValue = isWallet
    ? (net !== null && net > 0 ? net : 0)
    : cur === "USD" ? singleAmt : rateNum ? singleAmt / rateNum : 0;
  const shownAmount = isWallet ? (net !== null ? formatUsd(Math.max(net, 0)) : "…") : formatMoney(singleAmt, cur);

  const forName = (id) => members.find((m) => m.id === id)?.display_name;
  const targetId = forWho && forWho !== "family" ? forWho : memberId;
  const periodWord = (p) => (p === "weekly" ? "weekly" : p === "monthly" ? "monthly" : p || "");
  const periodNoun = (p) => (p === "weekly" ? "week" : "month");
  let limitCard = null;
  if (isFamily) {
    const f = limits?.family;
    limitCard = (
      <LimitCard
        label={f ? `Family budget this ${periodNoun(f.period)}` : ""}
        spend={f} added={usdValue}
        extra="Family cost: counts toward the family budget, not anyone's personal limit."
      />
    );
  } else {
    const sp = targetId === memberId ? limits?.me : limits?.members?.[targetId];
    const whose = targetId === memberId ? "Your" : `${forName(targetId) ?? "Their"}'s`;
    limitCard = <LimitCard label={sp ? `${whose} ${periodWord(sp.period)} limit` : ""} spend={sp} added={usdValue} />;
  }

  const visibleCats = allCats || categories.length <= CATS_SHOWN + 1
    ? categories
    : categories.filter((c, i) => i < CATS_SHOWN || c.id === categoryId);
  const hiddenCats = categories.length - visibleCats.length;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (when && new Date(when) > new Date()) { setMoreOpen(true); return setError("The date cannot be in the future."); }
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

  const balanceOf = (wallets) =>
    showSplit
      ? `${formatUsd(bal(wallets?.USD))} · ${formatLbp(bal(wallets?.LBP))}`
      : formatMoney(bal(wallets?.[cur]), cur);

  const buttonLabel = busy
    ? "Saving..."
    : kind === "expense" || (kind === "card-spend" && targetId === memberId)
    ? `Add expense · ${shownAmount}`
    : kind === "card-spend"
    ? `Add for ${forName(targetId) ?? "them"} · ${shownAmount}`
    : `Record family cost · ${shownAmount}`;

  const showPaidFrom = cardChoices.length > 0 || amAdmin;
  const approx = !showSplit && cur === "LBP" && rateNum && singleAmt ? `≈ ${formatUsd(singleAmt / rateNum)} at ${formatRate(rateNum).replace(" per $1", "")}` : null;
  const splitSummary = showSplit && net !== null
    ? [num(paidUsd) ? formatUsd(num(paidUsd)) : null, num(paidLbp) ? formatLbp(num(paidLbp)) : null].filter(Boolean).join(" + ") +
      (usesLbp ? ` at ${formatRate(rateNum).replace(" per $1", "")}` : "") +
      (num(changeUsd) || num(changeLbp) ? " − change" : "")
    : null;

  return (
    <form onSubmit={handleSubmit} className="spend-form">
      <div className="sf-scroll">
        {/* amount */}
        <div className="sf-hero">
          {showSplit ? (
            <>
              <span className="sf-hero-label">Total spent</span>
              <span className="sf-hero-total">{net !== null ? formatUsd(Math.max(net, 0)) : "—"}</span>
              <span className="sf-muted sf-small">{splitSummary || (usesLbp && !rateNum ? "Enter the rate below" : "Enter what you paid")}</span>
            </>
          ) : (
            <>
              <div className="sf-hero-input">
                {cur === "USD" && <span className="sf-symbol">$</span>}
                <input
                  type="text" inputMode="decimal" autoComplete="off" autoFocus aria-label={`Amount in ${cur}`}
                  placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)}
                  style={{ width: `${Math.max(2, amount.length + 1)}ch` }}
                />
                {cur === "LBP" && <span className="sf-symbol sf-symbol-small">LBP</span>}
              </div>
              {!isCard && (
                <div className="sf-pills" role="group" aria-label="Currency">
                  {["USD", "LBP"].map((c) => (
                    <button key={c} type="button" className={`sf-pill ${currency === c ? "on" : ""}`} aria-pressed={currency === c} onClick={() => changeCurrency(c)}>{c}</button>
                  ))}
                </div>
              )}
              {approx && <span className="sf-muted sf-small">{approx}</span>}
            </>
          )}
        </div>

        {isWallet && (
          <div className="sf-seg" role="group" aria-label="Currencies used">
            <button type="button" className={!split ? "on" : ""} aria-pressed={!split} onClick={() => setSplit(false)}>One currency</button>
            <button type="button" className={split ? "on" : ""} aria-pressed={split} onClick={() => setSplit(true)}>Both currencies</button>
          </div>
        )}

        {showSplit && (
          <>
            <div className="sf-block">
              <span className="sf-label">You paid</span>
              <div className="sf-two">
                <MoneyInput label="US dollars" unit="USD" value={paidUsd} onChange={setPaidUsd} placeholder="0" />
                <MoneyInput label="Lebanese pounds" unit="LBP" value={paidLbp} onChange={setPaidLbp} placeholder="0" />
              </div>
            </div>
            {showChange || num(changeUsd) || num(changeLbp) ? (
              <div className="sf-block">
                <span className="sf-label">Change you got back</span>
                <div className="sf-two">
                  <MoneyInput label="US dollars" unit="USD" value={changeUsd} onChange={setChangeUsd} placeholder="0" />
                  <MoneyInput label="Lebanese pounds" unit="LBP" value={changeLbp} onChange={setChangeLbp} placeholder="0" />
                </div>
              </div>
            ) : (
              <button type="button" className="sf-dashed" onClick={() => setShowChange(true)}>+ Got change back?</button>
            )}
          </>
        )}

        {usesLbp && (
          <MoneyInput
            label="Exchange rate (LBP per $1)" value={rate} onChange={(v) => { setRate(v); setRateIsDefault(false); }} placeholder="89,500" required
            help={rateNum ? (rateIsDefault ? "Today's family rate. Change it if today's differs." : formatRate(rateNum)) : "How many LBP equal $1 today"}
          />
        )}

        {/* paid from */}
        {showPaidFrom && (
          <div className="sf-block">
            <span className="sf-label">Paid from</span>
            <div className="sf-boxes">
              <button type="button" className={`sf-box ${isWallet ? "on" : ""}`} aria-pressed={isWallet} onClick={() => changePaidFrom("wallet")}>
                <strong>My wallet</strong><span>{balanceOf(myWallets)}</span>
              </button>
              {cardChoices.map(({ card, acct }) => (
                <button key={card.id} type="button" className={`sf-box ${paidFrom === `card:${card.id}` ? "on" : ""}`} aria-pressed={paidFrom === `card:${card.id}`} onClick={() => changePaidFrom(`card:${card.id}`)}>
                  <strong>{card.name}</strong><span>{formatMoney(bal(acct), acct.currency)}</span>
                </button>
              ))}
              {amAdmin && (
                <button type="button" className={`sf-box ${isPool ? "on" : ""}`} aria-pressed={isPool} onClick={() => changePaidFrom("pool")}>
                  <strong>Family pool</strong><span>{formatMoney(bal(accounts?.pool?.[currency]), currency)}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* for */}
        {isCard && (
          <div className="sf-block">
            <span className="sf-label">For</span>
            <div className="sf-chips">
              <button type="button" className={`sf-chip ${forWho === "" ? "on" : ""}`} aria-pressed={forWho === ""} onClick={() => setForWho("")}>Me</button>
              {members.filter((m) => m.id !== memberId).map((m) => (
                <button key={m.id} type="button" className={`sf-chip ${forWho === m.id ? "on" : ""}`} aria-pressed={forWho === m.id} onClick={() => setForWho(m.id)}>{m.display_name}</button>
              ))}
              {amAdmin && (
                <button type="button" className={`sf-chip ${forWho === "family" ? "on" : ""}`} aria-pressed={forWho === "family"} onClick={() => setForWho("family")}>Whole family</button>
              )}
            </div>
          </div>
        )}

        {isFamily && (
          <>
            <TextInput label="What for" value={title} onChange={setTitle} placeholder="Electricity, tuition, internet..." required />
            <div className="sf-block">
              <span className="sf-label">Related person <span className="sf-muted">(optional)</span></span>
              <div className="sf-chips">
                <button type="button" className={`sf-chip ${related === "" ? "on" : ""}`} aria-pressed={related === ""} onClick={() => setRelated("")}>Nobody</button>
                {members.map((m) => (
                  <button key={m.id} type="button" className={`sf-chip ${related === m.id ? "on" : ""}`} aria-pressed={related === m.id} onClick={() => setRelated(m.id)}>{m.display_name}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* category */}
        <div className="sf-block">
          <span className="sf-label">Category</span>
          <div className="sf-chips">
            {visibleCats.map((c) => (
              <button key={c.id} type="button" className={`sf-chip ${categoryId === c.id ? "on" : ""}`} aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                <i className="sf-dot" style={{ background: colorFor(c.name) }} />{c.name}
              </button>
            ))}
            {hiddenCats > 0 && <button type="button" className="sf-chip sf-chip-more" onClick={() => setAllCats(true)}>More...</button>}
            {(isFamily || isCard) && (
              <button type="button" className={`sf-chip ${categoryId === "" ? "on" : ""}`} aria-pressed={categoryId === ""} onClick={() => setCategoryId("")}>No category</button>
            )}
          </div>
        </div>

        {limitCard}

        {/* more options */}
        <div className="sf-more">
          <button type="button" className="sf-more-head" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            <span>More options</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" style={{ transform: moreOpen ? "none" : "rotate(180deg)" }}><path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          {moreOpen && (
            <div className="sf-two sf-more-body">
              <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} max={nowLocal()} help="Empty means now" />
              <TextInput label="Note" value={note} onChange={setNote} placeholder="Optional" />
            </div>
          )}
        </div>

        {error && <p className="status error" role="alert">{error}</p>}
      </div>

      <div className="sf-footer">
        <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy}>{buttonLabel}</button>
      </div>
    </form>
  );
}
