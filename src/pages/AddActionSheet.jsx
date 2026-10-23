import { useState } from "react";
import TransactionForm from "./TransactionForm";
import ExchangeForm from "./ExchangeForm";
import IncomeForm from "./IncomeForm";

const TABS = [
  { key: "expense", label: "Spend" },
  { key: "exchange", label: "Exchange" },
  { key: "income", label: "Add money" },
];

export default function AddActionSheet({ familyId, memberId, categories, accounts, members, cards, amAdmin, limits, initialTab = "expense", presetDest, onClose, onDone }) {
  const [tab, setTab] = useState(initialTab);

  function handleDone() {
    onDone?.();
    onClose?.();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sf-sheet-head">
          <div className="sf-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="sheet-body">
          {tab === "expense" && (
            <TransactionForm
              familyId={familyId} memberId={memberId} categories={categories} accounts={accounts}
              members={(members || []).filter((m) => !m.removed_at)} cards={cards || []} amAdmin={amAdmin} limits={limits} onDone={handleDone}
            />
          )}
          {tab === "income" && (
            <IncomeForm
              familyId={familyId} memberId={memberId} categories={categories} accounts={accounts}
              cards={cards || []} amAdmin={amAdmin} presetDest={presetDest} onDone={handleDone}
            />
          )}
          {tab === "exchange" && <ExchangeForm familyId={familyId} memberId={memberId} accounts={accounts} amAdmin={amAdmin} onDone={handleDone} />}
        </div>
      </div>
    </div>
  );
}
