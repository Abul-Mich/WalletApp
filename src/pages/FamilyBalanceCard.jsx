import { bal, fmtMoney, totalUsd } from "../lib/wallets";

// Shows the family pool (unallocated money) in both currencies, plus the
// whole family's money (pool + members + cards) in USD at the current rate.
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
      <div className="card-header-row"><h2>Family Pool</h2></div>
      <p className="balance">{fmtMoney(bal(pool.USD), "USD")}</p>
      <p className="balance">{fmtMoney(bal(pool.LBP), "LBP")}</p>
      <p className="hint">Money not yet taken by any member or card.</p>
      {rate > 0 && (
        <p className="hint">
          Whole family: {(poolUsd + membersUsd + cardsUsd).toFixed(2)} USD
          (pool {poolUsd.toFixed(2)} · members {membersUsd.toFixed(2)} · cards {cardsUsd.toFixed(2)}) at {Math.round(rate).toLocaleString()} LBP per USD.
        </p>
      )}
    </section>
  );
}
