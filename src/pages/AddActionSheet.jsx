import { useState } from 'react'
import TransactionForm from './TransactionForm'
import MemberBalanceTransfer from './MemberBalanceTransfer'
import AddToMainBalanceForm from './AddToMainBalanceForm'

const TABS = [
  { key: 'expense', label: 'Withdraw (Log Expense)' },
  { key: 'add', label: 'Add Balance' },
  { key: 'return', label: 'Return Balance' }
]

export default function AddActionSheet({
  familyId,
  memberId,
  baseCurrency,
  categories,
  currentBalance,
  onClose,
  onDone
}) {
  const [tab, setTab] = useState('expense')

  function handleDone() {
    onDone?.()
    onClose?.()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>Add</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="sheet-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`sheet-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="sheet-body">
          {tab === 'expense' && categories.length > 0 && (
            <TransactionForm
              familyId={familyId}
              memberId={memberId}
              baseCurrency={baseCurrency}
              categories={categories}
              currentBalance={currentBalance}
              onDone={handleDone}
            />
          )}
          {tab === 'expense' && categories.length === 0 && (
            <p className="hint">No categories set up yet.</p>
          )}

          {tab === 'add' && (
            <MemberBalanceTransfer
              familyId={familyId}
              memberId={memberId}
              baseCurrency={baseCurrency}
              onDone={handleDone}
            />
          )}

          {tab === 'return' && (
            <AddToMainBalanceForm
              familyId={familyId}
              memberId={memberId}
              baseCurrency={baseCurrency}
              currentBalance={currentBalance}
              onDone={handleDone}
            />
          )}
        </div>
      </div>
    </div>
  )
}
