import { useState } from 'react'
import { supabase } from '../supabaseClient'

// The displayed balance is a cache recomputed from scratch (deposits minus
// transactions plus any adjustments below) — so "editing" it doesn't touch
// wallets.balance_cache directly. Instead we insert a signed correction into
// wallet_balance_adjustments equal to (target - current), and the same
// recalc trigger used for deposits/transactions picks it up. Superadmin
// only: this is a bigger, rarer action than a normal deposit.
export default function FamilyBalanceCard({
  familyId,
  memberId,
  baseCurrency,
  wallet,
  unallocated,
  amSuperadmin,
  onChanged
}) {
  const [editing, setEditing] = useState(false)
  const [newBalance, setNewBalance] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const currentBalance = wallet ? Number(wallet.balance_cache) : 0

  const parsedTarget = parseFloat(newBalance)
  const delta = Number.isNaN(parsedTarget) ? 0 : parsedTarget - currentBalance
  const projectedUnallocated =
    unallocated !== null && !Number.isNaN(parsedTarget) ? unallocated + delta : null
  const wouldGoNegative = projectedUnallocated !== null && projectedUnallocated < 0

  function startEditing() {
    setNewBalance(currentBalance.toFixed(2))
    setNote('')
    setError(null)
    setEditing(true)
  }

  async function save() {
    setError(null)
    const target = parseFloat(newBalance)
    if (Number.isNaN(target)) {
      setError('Enter a valid number.')
      return
    }
    const delta = target - currentBalance
    if (delta === 0) {
      setEditing(false)
      return
    }
    if (unallocated !== null && unallocated + delta < 0) {
      setError(
        `This would leave ${(unallocated + delta).toFixed(2)} ${baseCurrency} unallocated — below what members and cards already hold. Lower the correction or adjust member/card balances first.`
      )
      return
    }

    setBusy(true)
    try {
      const { error: err } = await supabase.from('wallet_balance_adjustments').insert({
        family_id: familyId,
        set_by_member_id: memberId,
        amount: delta,
        note: note || null
      })
      if (err) throw err
      setEditing(false)
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="card-header-row">
        <h2>Family Balance</h2>
        {amSuperadmin && !editing && (
          <button type="button" className="link-button" onClick={startEditing}>
            Edit
          </button>
        )}
      </div>

      {!editing && (
        <>
          <p className="balance">
            {wallet ? currentBalance.toFixed(2) : '--'} {baseCurrency}
          </p>
          <p className="hint">
            Actual cash: total deposited minus total spent, live-synced.
          </p>
          {unallocated !== null && (
            <p className="hint">
              {unallocated.toFixed(2)} {baseCurrency} not yet allocated to
              any member's balance.
            </p>
          )}
        </>
      )}

      {editing && (
        <div className="inline-form">
          <input
            type="number"
            step="0.01"
            value={newBalance}
            onChange={(e) => setNewBalance(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <input
            placeholder="Reason (optional, e.g. bank reconciliation)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
          {projectedUnallocated !== null && (
            <p className={`hint ${wouldGoNegative ? 'warning' : ''}`}>
              {wouldGoNegative
                ? `Warning: this leaves ${projectedUnallocated.toFixed(2)} ${baseCurrency} unallocated — below what members and cards already hold.`
                : `${projectedUnallocated.toFixed(2)} ${baseCurrency} would remain unallocated.`}
            </p>
          )}
          <button type="button" onClick={save} disabled={busy || wouldGoNegative}>
            {busy ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            className="remove-btn"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
          {error && <p className="status error">{error}</p>}
        </div>
      )}
    </section>
  )
}
