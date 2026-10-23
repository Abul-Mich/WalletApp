import { useEffect, useMemo, useState } from "react";
import { INCOME_TYPES, bal, createIncome, latestLbpRate, loadPockets } from "../lib/wallets";
import { formatMoney, formatRate, parseNumber, convertAmountText } from "../lib/format";
import { MoneyInput, TextInput } from "../components/Field";
import AmountHero from "../components/AmountHero";
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

// "Add money": money that comes from outside the family. Members add to their own main wallet or
// pockets; admins can also add to a card or the family pool. A reimbursement is not income: it is
// tied to a category and lowers that category's spending.
// presetDest: "main" | "pocket:<id>" | "card:<id>" | "pool" (optional)
export default function IncomeForm({ familyId, memberId, categories = [], accounts, cards = [], amAdmin, presetDest, onDone }) {
  const [pockets, setPockets] = useState([]);
  const [kind, setKind] = useState("salary");
  const [dest, setDest] = useState(presetDest || "main");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [rate, setRate] = useState("");
  const [rateIsDefault, setRateIsDefault] = useState(false);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    loadPockets(memberId).then((p) => live && setPockets((p || []).filter((x) => !x.archived))).catch(() => {});
    latestLbpRate(familyId).then((r) => { if (live && r) { setRate(String(r)); setRateIsDefault(true); } });
    return () => { live = false; };
  }, [familyId, memberId]);

  const colorFor = useMemo(() => makeColorFor(categories), [categories]);

  const myWallets = accounts?.members?.[memberId] || {};
  const dests = [
    { key: "main", name: "My main wallet", accts: myWallets, both: true },
    ...pockets.filter((p) => accounts?.pockets?.[p.id]).map((p) => ({
      key: `pocket:${p.id}`, name: p.name, accts: { [accounts.pockets[p.id].currency]: accounts.pockets[p.id] }, both: false,
    })),
    ...(amAdmin ? cards.filter((k) => !k.archived && accounts?.cards?.[k.id]).map((k) => ({
      key: `card:${k.id}`, name: k.name, accts: { [accounts.cards[k.id].currency]: accounts.cards[k.id] }, both: false,
    })) : []),
    ...(amAdmin ? [{ key: "pool", name: "Family pool", accts: accounts?.pool || {}, both: true }] : []),
  ];
  const d = dests.find((x) => x.key === dest) || dests[0];
  const cur = d.both ? currency : Object.keys(d.accts)[0] || "USD";
  const acct = d.accts[cur];

  function pickDest(k) {
    setDest(k);
    const nd = dests.find((x) => x.key === k);
    if (nd && !nd.both) setCurrency(Object.keys(nd.accts)[0]);
  }
  useEffect(() => {
    // a preset single-currency destination fixes the currency once the pockets have loaded
    if (!d.both) setCurrency(Object.keys(d.accts)[0] || "USD");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest, pockets.length]);

  const rateNum = num(rate);
  const amt = num(amount);
  const isReimb = kind === "reimbursement";
  const type = INCOME_TYPES.find((t) => t.key === kind);
  const approx = cur === "LBP" && rateNum && amt ? `≈ $${(amt / rateNum).toFixed(2)} at ${formatRate(rateNum).replace(" per $1", "")}` : null;

  function changeCurrency(c) {
    if (c === currency) return;
    setAmount(convertAmountText(amount, currency, c, rateNum));
    setCurrency(c);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!acct) return setError("Pick where the money goes.");
    if (!(amt > 0)) return setError("Enter an amount.");
    if (isReimb && !categoryId) return setError("Pick the category this reimbursement is for.");
    if (when && new Date(when) > new Date()) { setMoreOpen(true); return setError("The date cannot be in the future."); }
    if (cur === "LBP" && !rateNum) return setError("Enter the exchange rate (LBP per $1).");
    setBusy(true);
    try {
      await createIncome({
        accountId: acct.id, amount: amt, kind, lbpPerUsd: cur === "LBP" ? rateNum : null,
        categoryId: isReimb ? categoryId : null, note: note.trim().slice(0, 200) || null, createdAt: when ? new Date(when).toISOString() : null,
      });
      setAmount(""); setNote(""); setWhen("");
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const shown = amt ? formatMoney(amt, cur) : "";
  const label = busy ? "Saving..." : `Add ${shown || "money"} to ${d.name.replace(/^My /, "my ")}`;

  return (
    <form onSubmit={submit} className="spend-form inc-form">
      <div className="sf-scroll">
        <div className="inc-hero">
          <AmountHero value={amount} onChange={setAmount} currency={cur} onCurrency={d.both ? changeCurrency : null} fixedNote={!d.both ? `${cur} only` : null}>
            {approx && <span className="sf-muted sf-small">{approx}</span>}
          </AmountHero>
        </div>

        <div className="sf-block">
          <span className="sf-label">What kind of money</span>
          <div className="sf-chips">
            {INCOME_TYPES.map((t) => (
              <button key={t.key} type="button" className={`sf-chip ${kind === t.key ? "on" : ""}`} aria-pressed={kind === t.key} onClick={() => setKind(t.key)}>{t.label}</button>
            ))}
          </div>
          <p className="sf-limit-note inc-note">{type.note}</p>
        </div>

        {isReimb && (
          <div className="sf-block">
            <span className="sf-label">Which category was it for</span>
            <div className="sf-chips">
              {categories.map((c) => (
                <button key={c.id} type="button" className={`sf-chip ${categoryId === c.id ? "on" : ""}`} aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                  <i className="sf-dot" style={{ background: colorFor(c.name) }} />{c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sf-block">
          <span className="sf-label">Into</span>
          <div className="sf-boxes">
            {dests.map((x) => {
              const cs = x.both ? [currency] : Object.keys(x.accts);
              return (
                <button key={x.key} type="button" className={`sf-box ${dest === x.key ? "on" : ""}`} aria-pressed={dest === x.key} onClick={() => pickDest(x.key)}>
                  <strong>{x.name}</strong>
                  <span>{cs.map((c) => formatMoney(bal(x.accts[c]), c)).join(" · ")}</span>
                </button>
              );
            })}
          </div>
        </div>

        {cur === "LBP" && (
          <MoneyInput
            label="Exchange rate (LBP per $1)" value={rate} onChange={(v) => { setRate(v); setRateIsDefault(false); }} placeholder="89,500" required
            help={rateNum ? (rateIsDefault ? "Today's family rate. Change it if today's differs." : formatRate(rateNum)) : "How many LBP equal $1 today"}
          />
        )}

        <div className="sf-more">
          <button type="button" className="sf-more-head" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            <span>Note and date</span>
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
        <button type="submit" className="btn btn-primary btn-block sf-submit inc-submit" disabled={busy}>{label}</button>
      </div>
    </form>
  );
}
