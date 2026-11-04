import { useState } from "react";
import DepositForm from "./DepositForm";
import { bal, totalUsd } from "../lib/wallets";
import { formatUsd, formatLbp, formatRate } from "../lib/format";

// Summary at the top of the Family page: the whole family's money, where it sits (pool, members, cards),
// and the family budget. Read-only apart from the admin's "Add to pool".
export default function FamilyBalanceCard({ accounts, rate, familyId, amAdmin, budget, onChanged }) {
  const [adding, setAdding] = useState(false);
  const pool = accounts.pool;
  const members = Object.values(accounts.members);
  const cards = Object.values(accounts.cards);
  const pockets = Object.values(accounts.pockets || {});
  const toUsd = (a) => (a.currency === "USD" ? bal(a) : rate > 0 ? bal(a) / rate : 0);

  const poolUsd = totalUsd(pool, rate);
  const membersUsd = members.reduce((s, p) => s + totalUsd(p, rate), 0);
  const cardsUsd = cards.reduce((s, a) => s + toUsd(a), 0);
  const pocketsUsd = pockets.reduce((s, a) => s + toUsd(a), 0);
  const total = poolUsd + membersUsd + cardsUsd + pocketsUsd;

  return (
    <section className="fam-summary">
      <div className="fam-summary-top">
        <div>
          <span className="fam-label">Family money</span>
          <span className="fam-total">{formatUsd(total)}</span>
        </div>
        {rate > 0 && <span className="fam-rate">1 USD =<br />{formatRate(rate)}</span>}
      </div>

      <div className="fam-tiles">
        <div className="fam-tile">
          <span className="fam-label">Pool</span>
          <strong>{formatUsd(bal(pool.USD))}</strong>
          <span className="fam-sub">{formatLbp(bal(pool.LBP))}</span>
        </div>
        <div className="fam-tile">
          <span className="fam-label">Members</span>
          <strong>{formatUsd(membersUsd)}</strong>
          <span className="fam-sub">in hand</span>
        </div>
        <div className="fam-tile">
          <span className="fam-label">Cards</span>
          <strong>{formatUsd(cardsUsd)}</strong>
          <span className="fam-sub">{cards.length} active</span>
        </div>
      </div>
      {pockets.length > 0 && (
        <p className="fam-note">Includes {amAdmin ? "pockets" : "your pockets"} {formatUsd(pocketsUsd)}.</p>
      )}

      {budget && (
        <div className="fam-budget">
          <div className="fam-budget-row"><span>Family budget, {budget.period}</span><span>{formatUsd(budget.spent)} of {formatUsd(budget.limit)}</span></div>
          <div className="breakdown-bar-track">
            <div
              className={`breakdown-bar ${budget.isOverLimit ? "over" : budget.isNearLimit ? "near" : ""}`}
              style={{ width: `${Math.min(budget.percentUsed * 100, 100)}%` }}
            />
          </div>
        </div>
      )}

      {amAdmin && (
        <button type="button" className="fam-addpool" onClick={() => setAdding(true)}>Add funds to the pool</button>
      )}

      {adding && (
        <div className="sheet-backdrop" onClick={() => setAdding(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <h2>Add funds to the pool</h2>
              <button type="button" className="sheet-close" aria-label="Close" onClick={() => setAdding(false)}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            </div>
            <div className="sheet-body">
              <DepositForm familyId={familyId} accounts={accounts} onDone={() => { setAdding(false); onChanged?.(); }} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
