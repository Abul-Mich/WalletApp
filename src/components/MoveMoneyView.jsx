import { useEffect, useState } from "react";
import { latestLbpRate, bal } from "../lib/wallets";
import { formatMoney, formatRate, parseNumber, convertAmountText } from "../lib/format";
import { MoneyInput, TextInput } from "./Field";
import AmountHero from "./AmountHero";

const num = (v) => {
  const n = parseNumber(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// One layout for every "move money" form: take from / return to the pool, add funds to the pool,
// top up a card, move a card's money to a wallet.
//
//   resolve(currency) -> { sources: [{ key, label, acct }], to: { label, acct } }
//       sources is empty for "money from outside" (adding funds to the pool).
//   fixedCurrency     -> a card holds one currency, so no USD/LBP pills.
//   verb(amountText)  -> the button label, e.g. "Take $50.00 from pool".
//   submit({ from, to, amount, currency, rate, tag, createdAt }) does the actual call.
export default function MoveMoneyView({
  familyId, resolve, fixedCurrency = null, fixedNoun = "card", outside = false, verb, note, members = [], showTag = false, showWhen = false,
  fromLabel, emptyText, submit, onDone,
}) {
  const [currency, setCurrency] = useState(fixedCurrency || "USD");
  const [amount, setAmount] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [tag, setTag] = useState("");
  const [when, setWhen] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!familyId) return;
    latestLbpRate(familyId).then((r) => r && setRate(String(Math.round(Number(r)))));
  }, [familyId]);

  const cur = fixedCurrency || currency;
  const { sources = [], to } = resolve(cur);
  const chosen = sources.find((s) => s.key === sourceKey) || sources[0] || null;
  const available = chosen ? bal(chosen.acct) : null;
  const amt = num(amount);
  const rateNum = num(rate);
  const over = available !== null && amt > available + 1e-9;
  const needsRate = outside && cur === "LBP";
  const ready = !!to?.acct && (outside || !!chosen);
  const valid = ready && amt > 0 && !over && (!needsRate || rateNum > 0);

  function changeCurrency(c) {
    if (c === currency) return;
    setAmount(convertAmountText(amount, currency, c, rateNum));
    setCurrency(c);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    if (when && new Date(when) > new Date()) { setMoreOpen(true); return setError("The date cannot be in the future."); }
    setBusy(true);
    setError(null);
    try {
      await submit({
        from: chosen?.acct, to: to.acct, amount: amt, currency: cur, rate: needsRate ? rateNum : null,
        tag: tag || null, createdAt: when ? new Date(when).toISOString() : null,
      });
      setAmount(""); setWhen("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready && emptyText) return <p className="hint">{emptyText}</p>;

  const label = over ? `Not enough ${cur}` : valid ? verb(formatMoney(amt, cur)) : amt > 0 && needsRate ? "Enter the exchange rate" : "Enter an amount";
  const approx = cur === "LBP" && rateNum && amt ? `≈ ${formatMoney(amt / rateNum, "USD")} at ${Math.round(rateNum).toLocaleString("en-US")}` : null;

  return (
    <form onSubmit={handleSubmit} className="spend-form">
      <div className="sf-scroll">
        <div className="sf-block">
          <span className="sf-label">{fromLabel || (sources.length > 1 ? "Take from" : "From")}</span>
          <div className="sf-boxes">
            {outside ? (
              <div className="sf-box sf-box-dashed"><strong>Money from outside</strong><span>Cash or a bank deposit</span></div>
            ) : (
              sources.map((s) => (
                <button key={s.key} type="button" className={`sf-box ${chosen?.key === s.key ? "on" : ""}`} aria-pressed={chosen?.key === s.key} disabled={sources.length === 1} onClick={() => setSourceKey(s.key)}>
                  <strong>{s.label}</strong><span>{formatMoney(bal(s.acct), cur)}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <AmountHero
          value={amount} onChange={setAmount} currency={cur}
          onCurrency={fixedCurrency ? null : changeCurrency}
          fixedNote={fixedCurrency ? `This ${fixedNoun} holds ${fixedCurrency}` : null}
        >
          {approx && <span className="sf-muted sf-small">{approx}</span>}
          {chosen && (
            <div className="sf-avail">
              <span className={over ? "bad" : ""}>{over ? `More than available · ${formatMoney(available, cur)}` : `Available: ${formatMoney(available, cur)}`}</span>
              <button type="button" className="ex-max" onClick={() => setAmount(String(Math.round(available * 100) / 100))}>Max</button>
            </div>
          )}
        </AmountHero>

        {needsRate && (
          <MoneyInput
            label="Exchange rate (LBP per $1)" value={rate} onChange={setRate} placeholder="89,500" required
            help={rateNum ? `${formatRate(rateNum)} · pre-filled from the last rate used` : "How many LBP equal $1 today"}
          />
        )}

        <div className="sf-limit">
          {chosen && <div className="sf-limit-row"><span>{chosen.label} after</span><strong>{formatMoney(available - amt, cur)}</strong></div>}
          {to?.acct && <div className="sf-limit-row"><span>{to.label} after</span><strong>{formatMoney(bal(to.acct) + amt, cur)}</strong></div>}
          {note && <p className="sf-limit-note">{note}</p>}
        </div>

        {showTag && (
          <div className="sf-block">
            <span className="sf-label">For <span className="sf-muted">(optional label)</span></span>
            <div className="sf-chips">
              <button type="button" className={`sf-chip ${tag === "" ? "on" : ""}`} aria-pressed={tag === ""} onClick={() => setTag("")}>No one</button>
              {members.map((m) => (
                <button key={m.id} type="button" className={`sf-chip ${tag === m.id ? "on" : ""}`} aria-pressed={tag === m.id} onClick={() => setTag(m.id)}>{m.display_name}</button>
              ))}
            </div>
          </div>
        )}

        {showWhen && (
          <div className="sf-more">
            <button type="button" className="sf-more-head" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
              <span>More options</span>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" style={{ transform: moreOpen ? "none" : "rotate(180deg)" }}><path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {moreOpen && (
              <div className="sf-more-body">
                <TextInput label="Date and time" type="datetime-local" value={when} onChange={setWhen} max={nowLocal()} help="Empty means now" />
              </div>
            )}
          </div>
        )}

        {error && <p className="status error" role="alert">{error}</p>}
      </div>

      <div className="sf-footer">
        <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !valid}>{busy ? "Working..." : label}</button>
      </div>
    </form>
  );
}
