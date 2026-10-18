import MoveMoneyView from "../components/MoveMoneyView";
import { createTransfer } from "../lib/wallets";

// Moves money from a shared prepaid card onto your own wallet (same currency).
// This is not spending: nothing counts toward a limit until you spend it from your wallet.
export default function CardToWalletForm({ cardAccount, memberAccounts, memberId, onDone }) {
  const cur = cardAccount.currency;
  const mine = memberAccounts?.[memberId]?.[cur];

  const resolve = () => ({
    sources: [{ key: "card", label: "This card", acct: cardAccount }],
    to: { label: "My wallet", acct: mine },
  });

  return (
    <MoveMoneyView
      familyId={cardAccount.family_id}
      fixedCurrency={cur}
      resolve={resolve}
      verb={(a) => `Move ${a} to my wallet`}
      note="This is not spending. Nothing counts toward a limit until you spend it from your wallet."
      showWhen
      emptyText={`You don't have a ${cur} wallet to move this into.`}
      submit={({ from, to, amount, createdAt }) => createTransfer({ from: from.id, to: to.id, amount, createdAt })}
      onDone={onDone}
    />
  );
}
