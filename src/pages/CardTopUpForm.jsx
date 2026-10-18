import MoveMoneyView from "../components/MoveMoneyView";
import { createTransfer } from "../lib/wallets";

// Moves money onto a shared prepaid card (same currency as the card) from the family pool
// or from a member's own wallet. Members can use the pool or their own wallet; admins can
// also use another member's wallet. The database refuses if the source does not have enough.
// The "For" tag is an optional label with no effect on limits.
export default function CardTopUpForm({ cardAccount, poolAccounts, memberAccounts, memberId, amAdmin, members, onDone }) {
  const cur = cardAccount.currency;

  const resolve = () => {
    const sources = [];
    if (poolAccounts?.[cur]) sources.push({ key: "pool", label: "Family pool", acct: poolAccounts[cur] });
    const mine = memberAccounts?.[memberId]?.[cur];
    if (mine) sources.push({ key: `m:${memberId}`, label: "My wallet", acct: mine });
    if (amAdmin) {
      for (const m of members || []) {
        const a = memberAccounts?.[m.id]?.[cur];
        if (a && m.id !== memberId) sources.push({ key: `m:${m.id}`, label: `${m.display_name}'s wallet`, acct: a });
      }
    }
    return { sources, to: { label: "This card", acct: cardAccount } };
  };

  return (
    <MoveMoneyView
      familyId={cardAccount.family_id}
      fixedCurrency={cur}
      resolve={resolve}
      fromLabel="Take from"
      verb={(a) => `Top up card · ${a}`}
      note="Moving money onto a card is not spending. No limit changes."
      members={(members || []).filter((m) => !m.removed_at)}
      showTag
      showWhen
      submit={({ from, to, amount, tag, createdAt }) => createTransfer({ from: from.id, to: to.id, amount, taggedMemberId: tag, createdAt })}
      onDone={onDone}
    />
  );
}
