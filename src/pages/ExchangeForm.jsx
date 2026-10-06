import { useEffect, useState } from "react";
import { createExchange, latestLbpRate, fmtMoney } from "../lib/wallets";

// Swap money between USD and LBP inside one holder's two wallets.
// Members exchange in their own wallets; admins can also exchange in the pool.
export default function ExchangeForm({ familyId, memberId, accounts, amAdmin, onDone }) {
  const [holder, setHolder] = useState("me");
  const [dir, setDir] = useState("USD_LBP"); // what you give _ what you get
  const [giveAmt, setGiveAmt] = useState("");
  const [getAmt, setGetAmt] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    latestLbpRate(familyId).then((r) => r && setRate(String(r)));
  }, [familyId]);

  const pair = holder === "pool" ? accounts.pool : accounts.members[memberId] || {};
  const [giveCur, getCur] = dir.split("_");
  const from = pair[giveCur];
  const to = pair[getCur];

  // Typing the give amount fills the get amount from the rate (still editable).
  function onGive(v) {
    setGiveAmt(v);
    const n = parseFloat(v), r = parseFloat(rate);
    if (n > 0 && r > 0) setGetAmt(giveCur === "USD" ? String(Math.round(n * r)) : String(Math.round((n / r) * 100) / 100));
  }

  const g = parseFloat(giveAmt), t = parseFloat(getAmt);
  const implied = g > 0 && t > 0 ? (giveCur === "USD" ? t / g : g / t) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createExchange({ from: from.id, to: to.id, amountFrom: g, amountTo: t });
      setGiveAmt("");
      setGetAmt("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inline-form">
      {amAdmin && (
        <select value={holder} onChange={(e) => setHolder(e.target.value)}>
          <option value="me">My wallets</option>
          <option value="pool">Family pool</option>
        </select>
      )}
      <select value={dir} onChange={(e) => { setDir(e.target.value); setGiveAmt(""); setGetAmt(""); }}>
        <option value="USD_LBP">USD → LBP</option>
        <option value="LBP_USD">LBP → USD</option>
      </select>
      <p className="hint">Available: {fmtMoney(from?.balance_cache, giveCur)}</p>
      <input type="number" step="any" min="0" placeholder={`You give (${giveCur})`} value={giveAmt} onChange={(e) => onGive(e.target.value)} required />
      <input type="number" step="any" min="0" placeholder={`You get (${getCur})`} value={getAmt} onChange={(e) => setGetAmt(e.target.value)} required />
      <input type="number" step="any" min="0" placeholder="Rate hint: LBP per 1 USD" value={rate} onChange={(e) => setRate(e.target.value)} />
      {implied && <p className="hint">Rate used: {Math.round(implied).toLocaleString()} LBP per USD</p>}
      <button type="submit" disabled={busy || !from || !to}>{busy ? "Exchanging..." : "Exchange"}</button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
