import { formatUsd, formatMoney } from "../lib/format";
import { dueText, shortDay, summarize, REPEAT_TEXT, monthName } from "../lib/bills";

const Chevron = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export const chipClass = (days) => (days < 0 ? "late" : days <= 3 ? "soon" : "later");

// One bill line, used on Home and on the Bills page.
export function BillLine({ bill, onClick }) {
  return (
    <button type="button" className="bl-row" onClick={onClick}>
      <span className={`bl-dot ${bill.scope}`} aria-hidden="true" />
      <span className="bl-main">
        <span className="bl-name">{bill.name}</span>
        <span className="bl-sub">{bill.scope === "family" ? "Family" : "Mine"} · due {shortDay(bill.due)} · {REPEAT_TEXT[bill.recurrence]}</span>
      </span>
      <span className="bl-side">
        <span className="bl-amt">{formatMoney(bill.amount, bill.currency)}</span>
        <span className={`bl-chip ${chipClass(bill.days)}`}>{dueText(bill.days)}</span>
      </span>
    </button>
  );
}

// Home: the next three bills, what is due this week, and a one-tap Pay on the most urgent bill.
export default function BillsCard({ items, paid, loaded, amAdmin, onOpen, onPay, onAdd }) {
  if (!loaded) return null;
  if (items.length === 0) {
    return (
      <button type="button" className="hs-slim hs-slim-row bl-empty" onClick={onAdd}>
        <span className="hs-slim-text"><span className="hs-muted">Bills</span><strong>No bills yet</strong></span>
        <span className="hs-link">Add one<Chevron /></span>
      </button>
    );
  }
  const s = summarize(items, paid);
  const next = items.slice(0, 3);
  const payable = items.find((b) => b.scope === "mine" || amAdmin);
  return (
    <section className="card bl-card" aria-label="Upcoming bills">
      <div className="card-header-row">
        <h2>Upcoming bills</h2>
        <button type="button" className="link-button" onClick={onOpen}>All bills ({items.length})</button>
      </div>
      <div className="bl-boxes">
        <div className="bl-box"><span>Due this week</span><strong>{formatUsd(s.weekUsd)}</strong></div>
        {s.lateCount > 0 && <div className="bl-box late"><span>{s.lateCount} overdue</span><strong>{formatUsd(s.lateUsd)}</strong></div>}
      </div>
      <div className="bl-list">
        {next.map((b) => <BillLine key={b.key} bill={b} onClick={() => onPay(b)} />)}
      </div>
      <div className="bl-actions">
        {payable && <button type="button" className="btn btn-secondary bl-pay" onClick={() => onPay(payable)}>Pay {payable.name}</button>}
        <button type="button" className="bl-plus" aria-label="Add a bill" onClick={onAdd}>+</button>
      </div>
    </section>
  );
}

export { monthName };
