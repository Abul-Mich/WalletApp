import TransactionForm from "./TransactionForm";

// Spend tab on a card: the same form as the "+" button, with this card already chosen.
export default function CardWithdrawForm({ familyId, memberId, members, categories, amAdmin, card, accounts, cards, onDone }) {
  return (
    <TransactionForm
      familyId={familyId} memberId={memberId} members={members} categories={categories} amAdmin={amAdmin}
      accounts={accounts} cards={cards} presetCardId={card.id} onDone={onDone}
    />
  );
}
