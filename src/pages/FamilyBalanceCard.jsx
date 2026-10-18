import { useState } from "react";
import DepositForm from "./DepositForm";
import { bal, totalUsd } from "../lib/wallets";
import { formatUsd, formatLbp, formatRate } from "../lib/format";

// Shows the family pool (money not yet taken by anyone) in both currencies,
// plus the whole family's money (pool + members + cards) in USD at the family rate.
export default function FamilyBalanceCard({ accounts, rate, familyId, amAdmin, onChanged }) {
  const [adding, setAdding] = useState(false);
  const pool = accounts.pool;
  const members = Object.values(accounts.members);
  const cards = Object.values(accounts.cards);

  const poolUsd = totalUsd(pool, rate);
  const membersUsd = members.reduce((s, p) => s + totalUsd(p, rate), 0);
  const cardsUsd = cards.reduce(
    (s, a) => s + (a.currency === "USD" ? bal(a) : rate > 0 ? bal(a) / rate : 0), 0);

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Family pool</h2>
        {amAdmin && (
          <button type="button" className="icon-btn" aria-label="Add funds to the family pool" title="Add funds" onClick={() => setAdding(true)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        )}
      </div>
      <p className="balance">{formatUsd(bal(pool.USD))}</p>
      <p className="balance">{formatLbp(bal(pool.LBP))}</p>
      <p className="hint">Money not yet taken by any member or card.</p>
      {rate > 0 && (
        <p className="hint">
          Whole family: {formatUsd(poolUsd + membersUsd + cardsUsd)}
          {" "}(pool {formatUsd(poolUsd)} · members {formatUsd(membersUsd)} · cards {formatUsd(cardsUsd)}) at {formatRate(rate)}.
        </p>
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
