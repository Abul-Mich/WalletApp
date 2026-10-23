import { useState } from "react";
import IncomeEditSheet from "./IncomeEditSheet";
import { useConfirm } from "../components/ConfirmSheet";
import { INCOME_TYPES, deleteIncome } from "../lib/wallets";
import { formatUsd, formatMoney, formatDateTime } from "../lib/format";

// One "money in" record (salary, bonus, gift, reimbursement, other) in a records list.
// Shown in green with a "+". A reimbursement also names the category it paid back.
export default function IncomeRow({ t, categories, members, canManage, amAdmin, onChanged }) {
  const [editing, setEditing] = useState(false);
  const { ask, dialog } = useConfirm();
  const type = INCOME_TYPES.find((x) => x.key === t.deposit_kind)?.label || "Money in";
  const cat = t.deposit_kind === "reimbursement" ? categories?.find((c) => c.id === t.category_id)?.name : null;
  const who = members?.find((m) => m.id === (t.beneficiary_member_id ?? t.added_by_member_id))?.display_name;
  const usd = Number(t.amount) * Number(t.exchange_rate_to_base || 1);

  function remove() {
    ask({
      title: "Delete this record?",
      detail: `${type} · ${formatUsd(usd)}`,
      effect: "The money is taken out of the wallet again. This cannot be undone.",
      confirmLabel: "Delete", cancelLabel: "Keep it", icon: "trash",
      onConfirm: async () => { await deleteIncome(t.id); onChanged?.(); },
    });
  }

  return (
    <li>
      <div>
        <span className="txn-amount pos">
          +{formatUsd(usd)}
          {t.currency && t.currency !== "USD" && <span className="txn-converted"> ({formatMoney(t.amount, t.currency)})</span>}
        </span>
        <span className="txn-meta">{type}{cat ? ` · ${cat}` : ""} · {who ?? "Family"} · {formatDateTime(t.created_at)}</span>
      </div>
      {t.note && <p className="txn-note">{t.note}</p>}
      {canManage && (
        <div className="txn-actions">
          <button type="button" onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className="remove-btn" onClick={remove}>Delete</button>
        </div>
      )}
      {editing && (
        <IncomeEditSheet record={t} kind={t.deposit_kind} categories={categories} members={members} amAdmin={amAdmin}
          onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged?.(); }} />
      )}
      {dialog}
    </li>
  );
}
