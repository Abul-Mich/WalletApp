import { useEffect, useState } from "react";
import { createExchange, latestLbpRate } from "../lib/wallets";
import { formatMoney, formatRate, parseNumber } from "../lib/format";
import { MoneyInput, SelectInput } from "../components/Field";

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

  // Typing the amount you give fills the amount you get from the rate (still editable).
  function onGive(v) {
    setGiveAmt(v);
    const n = parseNumber(v), r = parseNumber(rate);
    if (n > 0 && r > 0) setGetAmt(giveCur === "USD" ? String(Math.round(n * r)) : String(Math.round((n / r) * 100) / 100));
  }

  const g = parseNumber(giveAmt), t = parseNumber(getAmt);
  const implied = g > 0 && t > 0 ? (giveCur === "USD" ? t / g : g / t) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!(g > 0 && t > 0)) return setError("Enter both amounts.");
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
    <form onSubmit={handleSubmit} className="form-stack">
      <div className="grid">
        {amAdmin && (
          <SelectInput label="Wallet" value={holder} onChange={setHolder}>
            <option value="me">My wallets</option>
            <option value="pool">Family pool</option>
          </SelectInput>
        )}
        <SelectInput label="Direction" value={dir} onChange={(v) => { setDir(v); setGiveAmt(""); setGetAmt(""); }}>
          <option value="USD_LBP">US dollars to pounds</option>
          <option value="LBP_USD">Pounds to US dollars</option>
        </SelectInput>
      </div>
      <p className="hint">Available: {formatMoney(from?.balance_cache, giveCur)}</p>
      <div className="grid">
        <MoneyInput label="You give" unit={giveCur} value={giveAmt} onChange={onGive} placeholder="0" required autoFocus />
        <MoneyInput label="You get" unit={getCur} value={getAmt} onChange={setGetAmt} placeholder="0" required />
      </div>
      <MoneyInput
        label="Rate hint" unit="LBP/USD" value={rate} onChange={setRate} placeholder="89,500"
        help={implied ? `Rate used: ${formatRate(implied)}` : "Used to suggest the amount you get"}
      />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !from || !to}>
        {busy ? "Exchanging..." : "Exchange"}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  );
}
