import { bal, totalUsd } from "../lib/wallets";
import { formatUsd, formatLbp, formatRate } from "../lib/format";

// Shows the family pool (money not yet taken by anyone) in both currencies,
// plus the whole family's money (pool + members + cards) in USD at the family rate.
export default function FamilyBalanceCard({ accounts, rate }) {
  const pool = accounts.pool;
  const members = Object.values(accounts.members);
  const cards = Object.values(accounts.cards);

  const poolUsd = totalUsd(pool, rate);
  const membersUsd = members.reduce((s, p) => s + totalUsd(p, rate), 0);
  const cardsUsd = cards.reduce(
    (s, a) => s + (a.currency === "USD" ? bal(a) : rate > 0 ? bal(a) / rate : 0), 0);

  return (
    <section className="card">
      <div className="card-header-row"><h2>Family pool</h2></div>
      <p className="balance">{formatUsd(bal(pool.USD))}</p>
      <p className="balance">{formatLbp(bal(pool.LBP))}</p>
      <p className="hint">Money not yet taken by any member or card.</p>
      {rate > 0 && (
        <p className="hint">
          Whole family: {formatUsd(poolUsd + membersUsd + cardsUsd)}
          {" "}(pool {formatUsd(poolUsd)} · members {formatUsd(membersUsd)} · cards {formatUsd(cardsUsd)}) at {formatRate(rate)}.
        </p>
      )}
    </section>
  );
}
