import { useEffect, useState } from "react";
import { createExchange, latestLbpRate, bal } from "../lib/wallets";
import { formatUsd, formatLbp, formatMoney, parseNumber } from "../lib/format";

const num = (v) => {
  const n = parseNumber(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
// Plain text for an amount box: USD with up to 2 decimals, LBP in whole pounds.
const plain = (n, cur) => (cur === "USD" ? String(Math.round(n * 100) / 100) : Math.round(n).toLocaleString("en-US"));
const WARN_AT = 0.05; // warn when the rate is more than 5% from the family rate

// Swap money between USD and LBP inside one holder's two wallets.
// Members exchange in their own wallets; admins can also exchange in the pool.
// You give X, you get Y; typing either side keeps the other consistent with the rate.
export default function ExchangeForm({ familyId, memberId, accounts, amAdmin, onDone }) {
  const [holder, setHolder] = useState("me");
  const [dir, setDir] = useState("USD_LBP"); // what you give _ what you get
  const [giveAmt, setGiveAmt] = useState("");
  const [getAmt, setGetAmt] = useState("");
  const [familyRate, setFamilyRate] = useState(0); // latest rate the family used
  const [rate, setRate] = useState(0); // rate in force for this exchange (LBP per $1)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    latestLbpRate(familyId).then((r) => {
      if (r) { setFamilyRate(Number(r)); setRate(Number(r)); }
    });
  }, [familyId]);

  const wallets = { me: accounts?.members?.[memberId] || {}, pool: accounts?.pool || {} };
  const pair = wallets[holder];
  const [giveCur, getCur] = dir.split("_");
  const from = pair[giveCur];
  const to = pair[getCur];
  const available = bal(from);

  const toGet = (g, r) => (giveCur === "USD" ? g * r : g / r);

  function clearAmounts() { setGiveAmt(""); setGetAmt(""); setError(null); }

  function onGive(v) {
    setGiveAmt(v);
    setError(null);
    const n = num(v);
    setGetAmt(n > 0 && rate > 0 ? plain(toGet(n, rate), getCur) : "");
  }

  // Typing the amount you get changes the rate instead of being overwritten.
  function onGet(v) {
    setGetAmt(v);
    setError(null);
    const g = num(giveAmt), t = num(v);
    if (g > 0 && t > 0) setRate(Math.round(giveCur === "USD" ? t / g : g / t));
  }

  function swap() {
    setDir(`${getCur}_${giveCur}`);
    setGiveAmt(getAmt);
    setGetAmt(giveAmt);
    setError(null);
  }

  function useMax() {
    setGiveAmt(plain(available, giveCur));
    setGetAmt(rate > 0 ? plain(toGet(available, rate), getCur) : "");
  }

  const g = num(giveAmt), t = num(getAmt);
  const over = g > available + 1e-9;
  const valid = g > 0 && t > 0 && !over && !!from && !!to;
  const dev = familyRate > 0 && rate > 0 ? Math.abs(rate - familyRate) / familyRate : 0;
  const ownRate = familyRate > 0 && rate !== familyRate;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await createExchange({ from: from.id, to: to.id, amountFrom: g, amountTo: t });
      clearAmounts();
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const label = over ? `Not enough ${giveCur}` : valid ? `Exchange ${formatMoney(g, giveCur)} → ${formatMoney(t, getCur)}` : "Enter an amount";

  return (
    <form onSubmit={handleSubmit} className="spend-form">
      <div className="sf-scroll">
        {amAdmin && (
          <div className="sf-block">
            <span className="sf-label">Exchange in</span>
            <div className="sf-boxes">
              {[["me", "My wallets"], ["pool", "Family pool"]].map(([key, name]) => (
                <button key={key} type="button" className={`sf-box ${holder === key ? "on" : ""}`} aria-pressed={holder === key} onClick={() => { setHolder(key); clearAmounts(); }}>
                  <strong>{name}</strong>
                  <span>{formatUsd(bal(wallets[key].USD))} · {formatLbp(bal(wallets[key].LBP))}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ex-pair">
          <div className={`ex-card ${over ? "bad" : ""}`}>
            <div className="ex-card-head">
              <span>You give</span>
              <button type="button" className="ex-max" onClick={useMax}>Max</button>
            </div>
            <div className="ex-card-row">
              <input
                type="text" inputMode="decimal" autoComplete="off" autoFocus aria-label={`Amount you give in ${giveCur}`}
                placeholder="0" value={giveAmt} onChange={(e) => onGive(e.target.value)}
              />
              <span className="ex-cur">{giveCur}</span>
            </div>
            <span className={`ex-sub ${over ? "bad" : ""}`}>
              {over ? `More than you have · available ${formatMoney(available, giveCur)}` : `Available: ${formatMoney(available, giveCur)}`}
            </span>
          </div>

          <div className="ex-card">
            <div className="ex-card-head"><span>You get</span></div>
            <div className="ex-card-row">
              <input
                type="text" inputMode="decimal" autoComplete="off" aria-label={`Amount you get in ${getCur}`}
                placeholder="0" value={getAmt} onChange={(e) => onGet(e.target.value)}
              />
              <span className="ex-cur">{getCur}</span>
            </div>
            <span className="ex-sub">
              {t > 0 ? `New balance: ${formatMoney(bal(to) + t, getCur)}` : `Balance: ${formatMoney(bal(to), getCur)}`}
            </span>
          </div>

          <button type="button" className="ex-swap" aria-label="Swap currencies" onClick={swap}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path d="M8 4v16M8 20l-3-3M8 20l3-3M16 20V4M16 4l-3 3M16 4l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="sf-block ex-rate">
          <div className="ex-rate-row">
            <span>{rate > 0 ? `1 USD = ${Math.round(rate).toLocaleString("en-US")} LBP` : "Enter both amounts to set the rate"}</span>
            {familyRate > 0 && <span className={ownRate ? "own" : "family"}>{ownRate ? "your rate" : "today's family rate"}</span>}
          </div>
          {dev > WARN_AT && (
            <span className="ex-warn">This is {Math.round(dev * 100)}% away from the family rate ({Math.round(familyRate).toLocaleString("en-US")}). Check the amounts.</span>
          )}
        </div>

        {error && <p className="status error" role="alert">{error}</p>}
      </div>

      <div className="sf-footer">
        <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !valid}>
          {busy ? "Exchanging..." : label}
        </button>
      </div>
    </form>
  );
}
