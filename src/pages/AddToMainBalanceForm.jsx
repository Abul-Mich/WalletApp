import MoveMoneyForm from "./MoveMoneyForm";
// My wallet -> pool.
export default function AddToMainBalanceForm(props) {
  return <MoveMoneyForm direction="out" {...props} />;
}
