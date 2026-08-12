import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const PAGE_SIZE = 20

// Merges deposits (regular admin can edit/delete) and wallet_balance_adjustments
// (direct balance corrections, superadmin-only to edit/delete) into one
// chronological list, since both feed the same wallets.balance_cache
// computation and an admin correcting the family balance needs to see both
// kinds of entries in one place, not two separate screens.
export default function FamilyBalanceHistoryAdmin({ baseCurrency, amSuperadmin, onChanged }) {
  const [rows, setRows] = useState([])
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editingKey, setEditingKey] = useState(null)
  const [editAmount, setEditAmount] = useState('')
  const [error, setError] = useState(null)

  async function load(nextLimit) {
    setLoading(true)
    const [{ data: deposits }, { data: adjustments }] = await Promise.all([
      supabase
        .from('deposits')
        .select('*, members:added_by_member_id(display_name)')
        .order('created_at', { ascending: false })
        .limit(nextLimit),
      supabase
        .from('wallet_balance_adjustments')
        .select('*, members:set_by_member_id(display_name)')
        .order('created_at', { ascending: false })
        .limit(nextLimit)
    ])

    const merged = [
      ...(deposits || []).map((d) => ({ ...d, kind: 'deposit' })),
      ...(adjustments || []).map((a) => ({ ...a, kind: 'adjustment' }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

    setRows(merged.slice(0, nextLimit))
    setHasMore((deposits || []).length === nextLimit || (adjustments || []).length === nextLimit)
    setLoading(false)
  }

  useEffect(() => {
    load(limit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit])

  function refresh() {
    setLimit(PAGE_SIZE)
    load(PAGE_SIZE)
    onChanged?.()
  }

  function rowKey(row) {
    return `${row.kind}-${row.id}`
  }

  async function saveEdit(row) {
    setError(null)
    const parsed = parseFloat(editAmount)
    if (Number.isNaN(parsed) || parsed === 0) {
      setError('Enter a non-zero amount.')
      return
    }
    const table = row.kind === 'deposit' ? 'deposits' : 'wallet_balance_adjustments'
    const { error: err } = await supabase.from(table).update({ amount: parsed }).eq('id', row.id)
    if (err) {
      setError(err.message)
      return
    }
    setEditingKey(null)
    refresh()
  }

  async function remove(row) {
    if (!confirm('Delete this entry? The family balance will be recalculated.')) return
    const table = row.kind === 'deposit' ? 'deposits' : 'wallet_balance_adjustments'
    const { error: err } = await supabase.from(table).delete().eq('id', row.id)
    if (err) {
      setError(err.message)
      return
    }
    refresh()
  }

  function canManage(row) {
    return row.kind === 'deposit' ? true : amSuperadmin
  }

  return (
    <div>
      {error && <p className="status error">{error}</p>}
      {loading && rows.length === 0 && <p className="hint">Loading...</p>}
      {!loading && rows.length === 0 && <p className="hint">No deposits or adjustments yet.</p>}

      <ul className="txn-list">
        {rows.map((r) => (
          <li key={rowKey(r)}>
            {editingKey === rowKey(r) ? (
              <div className="inline-form">
                <input
                  type="number"
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
                <button type="button" onClick={() => saveEdit(r)}>
                  Save
                </button>
                <button type="button" className="remove-btn" onClick={() => setEditingKey(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div>
                  <span className="txn-amount">
                    {r.kind === 'deposit' ? '+' : Number(r.amount) > 0 ? '+' : ''}
                    {Number(r.amount).toFixed(2)} {r.currency || baseCurrency}
                    {r.currency && r.currency !== baseCurrency && (
                      <span className="txn-converted">
                        {' '}
                        (≈{(r.amount * r.exchange_rate_to_base).toFixed(2)} {baseCurrency})
                      </span>
                    )}
                  </span>
                  <span className="txn-meta">
                    {r.kind === 'deposit' ? 'Deposit' : 'Balance Correction'} ·{' '}
                    {r.members?.display_name}
                    {r.note && ` · ${r.note}`}
                  </span>
                </div>
                {canManage(r) && (
                  <div className="txn-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingKey(rowKey(r))
                        setEditAmount(String(r.amount))
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="remove-btn" onClick={() => remove(r)}>
                      Delete
                    </button>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      {hasMore && (
        <button
          type="button"
          className="load-more"
          disabled={loading}
          onClick={() => setLimit((l) => l + PAGE_SIZE)}
        >
          {loading ? 'Loading...' : 'Load 20 More'}
        </button>
      )}
    </div>
  )
}
