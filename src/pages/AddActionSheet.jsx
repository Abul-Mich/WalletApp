import { useState } from "react";
import TransactionForm from "./TransactionForm";
import ExchangeForm from "./ExchangeForm";

const TABS = [
  { key: "expense", label: "Spend" },
  { key: "exchange", label: "Exchange" },
];

export default function AddActionSheet({ familyId, memberId, categories, accounts, members, cards, amAdmin, onClose, onDone }) {
  const [tab, setTab] = useState("expense");

  function handleDone() {
    onDone?.();
    onClose?.();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>Add</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="sheet-tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button" className={`sheet-tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="sheet-body">
          {tab === "expense" && (
            <TransactionForm
              familyId={familyId} memberId={memberId} categories={categories} accounts={accounts}
              members={(members || []).filter((m) => !m.removed_at)} cards={cards || []} amAdmin={amAdmin} onDone={handleDone}
            />
          )}
          {tab === "exchange" && <ExchangeForm familyId={familyId} memberId={memberId} accounts={accounts} amAdmin={amAdmin} onDone={handleDone} />}
        </div>
      </div>
    </div>
  );
}
