import MoveMoneyForm from "./MoveMoneyForm";
// Pool -> my wallet.
export default function MemberBalanceTransfer(props) {
  return <MoveMoneyForm direction="in" {...props} />;
}
