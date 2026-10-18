import MoveMoneyView from "../components/MoveMoneyView";
import { createDeposit } from "../lib/wallets";

// Admin only: add money to the family pool in USD or LBP.
export default function DepositForm({ familyId, accounts, onDone }) {
  const resolve = (cur) => ({ sources: [], to: { label: "Family pool", acct: accounts.pool[cur] } });
  return (
    <MoveMoneyView
      familyId={familyId}
      outside
      resolve={resolve}
      verb={(a) => `Add ${a} to pool`}
      note="Counts as new money in the family pool."
      submit={({ to, amount, rate }) => createDeposit({ accountId: to.id, amount, lbpPerUsd: rate })}
      onDone={onDone}
    />
  );
}
