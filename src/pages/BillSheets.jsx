import { useEffect, useState } from "react";
import { bal, latestLbpRate } from "../lib/wallets";
import { createBill, deleteBill, payBill, todayKey, addDaysKey, addMonthKey, shortDay, REPEAT_TEXT } from "../lib/bills";
import { formatMoney, formatRate, parseNumber, convertAmountText } from "../lib/format";
import { MoneyInput, TextInput } from "../components/Field";
import AmountHero from "../components/AmountHero";
import { useConfirm } from "../components/ConfirmSheet";
import { CategoryChips, PersonChips, EditSheet } from "../components/RecordFields";

const num = (v) => {
  const n = parseNumber(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// ---------------------------------------------------------------- pay --

function PayBillSheet({ bill, accounts, cards, memberId, amAdmin, familyId, defaultRate, onClose, onDone }) {
  const cur = bill.currency;
  const canPay = bill.scope === "mine" || amAdmin;
  const [amount, setAmount] = useState(String(bill.amount));
  const [rateText, setRateText] = useState(defaultRate ? String(Math.round(defaultRate)) : "");
  const [srcId, setSrcId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    if (cur === "LBP" && !rateText) latestLbpRate(familyId).then((r) => r && setRateText(String(Math.round(Number(r)))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wallet = accounts?.members?.[memberId]?.[cur];
  const sources = bill.scope === "mine"
    ? [{ id: wallet?.id, name: "My main wallet", sub: "Cash in hand", balance: bal(wallet) }]
    : [
        ...(accounts?.pool?.[cur] ? [{ id: "", name: "Family pool", sub: "Admin only", balance: bal(accounts.pool[cur]) }] : []),
        ...(cards || []).filter((k) => !k.archived && accounts?.cards?.[k.id]?.currency === cur)
          .map((k) => ({ id: accounts.cards[k.id].id, name: k.name, sub: "Card", balance: bal(accounts.cards[k.id]) })),
      ];
  const amt = num(amount);
  const enough = (s) => s.balance >= amt;
  const chosen = sources.find((s) => (srcId === null ? false : s.id === srcId)) || sources.find(enough) || sources[0];
  const rateNum = num(rateText);

  async function pay(e) {
    e.preventDefault();
    setError(null);
    if (!(amt > 0)) return setError("Enter the amount.");
    if (cur === "LBP" && !rateNum) return setError("Enter the exchange rate (LBP per $1).");
    if (!chosen || !enough(chosen)) return setError(`Not enough money in ${chosen?.name || "that wallet"}.`);
    setBusy(true);
    try {
      await payBill(bill, { amount: amt, accountId: chosen.id || null, lbpPerUsd: cur === "LBP" ? rateNum : null, memberId });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  function remove() {
    ask({
      title: `Delete "${bill.name}"?`,
      detail: `${formatMoney(bill.amount, cur)} ${REPEAT_TEXT[bill.recurrence]}`,
      effect: "The bill stops showing up. Payments already made stay in your records.",
      confirmLabel: "Delete bill", cancelLabel: "Keep it", icon: "trash",
      onConfirm: async () => { await deleteBill(bill); onDone(); },
    });
  }

  return (
    <EditSheet title={`Pay ${bill.name}`} onClose={busy ? undefined : onClose}>
      <form onSubmit={pay} className="spend-form">
        <div className="sf-scroll">
          <AmountHero value={amount} onChange={setAmount} currency={cur} autoFocus={false}
            fixedNote={`Usual amount: ${formatMoney(bill.amount, cur)} · ${bill.scope === "family" ? "family bill" : "your bill"}`} />

          {cur === "LBP" && (
            <MoneyInput label="Exchange rate (LBP per $1)" value={rateText} onChange={setRateText} placeholder="89,500" required
              help={rateNum ? formatRate(rateNum) : "How many LBP equal $1 today"} />
          )}

          {!canPay ? (
            <p className="status">Only admins can pay family bills.</p>
          ) : (
            <div className="sf-block">
              <span className="sf-label">Pay from</span>
              <div className="sf-boxes">
                {sources.length === 0 && <p className="hint">No {cur} wallet to pay from.</p>}
                {sources.map((s) => (
                  <button key={s.id || "pool"} type="button" disabled={!enough(s)}
                    className={`sf-box ${chosen && s.id === chosen.id ? "on" : ""} ${enough(s) ? "" : "bl-off"}`}
                    aria-pressed={chosen && s.id === chosen.id} onClick={() => setSrcId(s.id)}>
                    <strong>{s.name}</strong>
                    <span>{enough(s) ? formatMoney(s.balance, cur) : `Not enough (${formatMoney(s.balance, cur)})`}</span>
                  </button>
                ))}
              </div>
              {chosen && amt > 0 && enough(chosen) && (
                <span className="sf-muted sf-small" style={{ marginTop: 8 }}>{formatMoney(chosen.balance - amt, cur)} left in {chosen.name} after paying.</span>
              )}
            </div>
          )}
          {error && <p className="status error" role="alert">{error}</p>}
          {(bill.scope === "mine" || amAdmin) && (
            <button type="button" className="pk-edit-link" onClick={remove}>Delete this bill</button>
          )}
        </div>
        {canPay && (
          <div className="sf-footer">
            <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !chosen || !(amt > 0)}>
              {busy ? "Paying..." : `Pay ${amt > 0 ? formatMoney(amt, cur) : ""}${chosen ? ` from ${chosen.name}` : ""}`}
            </button>
          </div>
        )}
      </form>
      {dialog}
    </EditSheet>
  );
}

// ---------------------------------------------------------------- add --

function AddBillSheet({ familyId, memberId, categories, members, amAdmin, preset, onClose, onDone }) {
  const today = todayKey();
  const choices = [
    { key: "today", label: "Today", value: today },
    { key: "week", label: "In a week", value: addDaysKey(today, 7) },
    { key: "month", label: "Next month", value: addMonthKey(today) },
  ];
  const [scope, setScope] = useState(preset === "family" && amAdmin ? "family" : "mine");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rate, setRate] = useState("");
  const [recurrence, setRecurrence] = useState("monthly");
  const [due, setDue] = useState(choices[1].value);
  const [pickDate, setPickDate] = useState(false);
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    latestLbpRate(familyId).then((r) => r && setRate(String(Math.round(Number(r)))));
  }, [familyId]);

  function changeCurrency(c) {
    if (c === currency) return;
    setAmount(convertAmountText(amount, currency, c, num(rate)));
    setCurrency(c);
  }

  const n = num(amount);
  const family = scope === "family";

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the bill a name.");
    if (!(n > 0)) return setError("Enter the usual amount.");
    if (!due) return setError("Choose the next due date.");
    setBusy(true);
    try {
      await createBill({ scope, familyId, memberId, name, amount: n, currency, recurrence, due, categoryId: family ? categoryId : categoryId || null, taggedMemberId: family ? tag : null });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const people = [{ value: "", label: "Whole family" }, ...(members || []).filter((m) => !m.removed_at).map((m) => ({ value: m.id, label: m.display_name }))];

  return (
    <EditSheet title="Add a bill" onClose={busy ? undefined : onClose}>
      <form onSubmit={submit} className="spend-form">
        <div className="sf-scroll">
          <TextInput label="Name" value={name} onChange={setName} placeholder="Rent, internet, gym..." required />
          <AmountHero value={amount} onChange={setAmount} currency={currency} onCurrency={changeCurrency} autoFocus={false}>
            <span className="sf-muted sf-small">Usual amount. You can change it each time you pay.</span>
          </AmountHero>

          {amAdmin && (
            <div className="sf-block">
              <span className="sf-label">Whose bill</span>
              <div className="sf-seg" role="group" aria-label="Whose bill">
                <button type="button" className={!family ? "on" : ""} aria-pressed={!family} onClick={() => setScope("mine")}>Mine</button>
                <button type="button" className={family ? "on" : ""} aria-pressed={family} onClick={() => setScope("family")}>Family</button>
              </div>
              <span className="sf-muted sf-small" style={{ marginTop: 8 }}>
                {family ? "Everyone in the family sees it. Paid by an admin from the pool or a card." : "Only you see it. Paid from your own wallet."}
              </span>
            </div>
          )}

          <div className="sf-block">
            <span className="sf-label">Repeats</span>
            <div className="sf-seg" role="group" aria-label="Repeats">
              {[["monthly", "Monthly"], ["weekly", "Weekly"], ["one_time", "One time"]].map(([k, l]) => (
                <button key={k} type="button" className={recurrence === k ? "on" : ""} aria-pressed={recurrence === k} onClick={() => setRecurrence(k)}>{l}</button>
              ))}
            </div>
          </div>

          <div className="sf-block">
            <span className="sf-label">Next due</span>
            <div className="sf-chips">
              {choices.map((c) => (
                <button key={c.key} type="button" className={`sf-chip ${!pickDate && due === c.value ? "on" : ""}`} aria-pressed={!pickDate && due === c.value} onClick={() => { setPickDate(false); setDue(c.value); }}>{c.label}</button>
              ))}
              <button type="button" className={`sf-chip ${pickDate ? "on" : ""}`} aria-pressed={pickDate} onClick={() => setPickDate(true)}>Pick date</button>
            </div>
            {pickDate
              ? <TextInput label="" type="date" value={due} onChange={setDue} required />
              : <span className="sf-muted sf-small" style={{ marginTop: 8 }}>{shortDay(due)}</span>}
          </div>

          <CategoryChips categories={categories || []} value={categoryId} onChange={setCategoryId} allowNone={family} />
          {family && <PersonChips label="For" hint="(optional)" value={tag} onChange={setTag} options={people} />}
          {error && <p className="status error" role="alert">{error}</p>}
        </div>
        <div className="sf-footer">
          <button type="submit" className="btn btn-primary btn-block sf-submit" disabled={busy || !name.trim() || !(n > 0)}>
            {busy ? "Saving..." : n > 0 ? `Add bill · ${formatMoney(n, currency)} ${REPEAT_TEXT[recurrence]}` : "Enter a name and amount"}
          </button>
        </div>
      </form>
    </EditSheet>
  );
}

// sheet = { type: "pay", bill } | { type: "add", preset }
export default function BillSheets({ sheet, onClose, onDone, ...ctx }) {
  if (!sheet) return null;
  if (sheet.type === "pay") return <PayBillSheet bill={sheet.bill} {...ctx} onClose={onClose} onDone={onDone} />;
  return <AddBillSheet preset={sheet.preset} {...ctx} onClose={onClose} onDone={onDone} />;
}
