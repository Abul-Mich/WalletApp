import MoveMoneyView from "../components/MoveMoneyView";
import { createTransfer } from "../lib/wallets";

// Moves money between the family pool and the caller's own wallet, in either
// direction. direction="in": pool -> my wallet. direction="out": my wallet -> pool.
export default function MoveMoneyForm({ direction, memberId, accounts, onDone }) {
  const mine = accounts.members[memberId] || {};
  const pool = accounts.pool;
  const familyId = pool.USD?.family_id || pool.LBP?.family_id;

  const resolve = (cur) => {
    const poolSide = { label: "Family pool", acct: pool[cur] };
    const mineSide = { label: "My wallet", acct: mine[cur] };
    const from = direction === "in" ? poolSide : mineSide;
    const to = direction === "in" ? mineSide : poolSide;
    return { sources: from.acct ? [{ key: "from", ...from }] : [], to };
  };

  return (
    <MoveMoneyView
      familyId={familyId}
      resolve={resolve}
      verb={(a) => (direction === "in" ? `Take ${a} from pool` : `Return ${a} to pool`)}
      note="Moving money is not spending. No limit changes."
      submit={({ from, to, amount }) => createTransfer({ from: from.id, to: to.id, amount })}
      onDone={onDone}
    />
  );
}
