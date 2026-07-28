import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { getExchangeRate, SUPPORTED_CURRENCIES } from '../lib/exchangeRates'

export default function TransactionRow({ t, familyId, baseCurrency, categories, canManage, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(t.amount)
  const [currency, setCurrency] = useState(t.currency)
  const [categoryId, setCategoryId] = useState(t.category_id ?? '')
  const [note, setNote] = useState(t.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const rate = await getExchangeRate(familyId, currency, baseCurrency)
      const { error: err } = await supabase
        .from('transactions')
        .update({
          amount: parseFloat(amount),
          currency,
          exchange_rate_to_base: rate,
          category_id: categoryId || null,
          note: note || null
        })
        .eq('id', t.id)
      if (err) throw err
      setEditing(false)
      onChanged?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete this ${t.amount} ${t.currency} transaction?`)) return
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.from('transactions').delete().eq('id', t.id)
      if (err) throw err
      onChanged?.()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <li className="txn-edit">
        <div className="inline-form">
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" disabled={busy} onClick={save}>
            {busy ? 'Saving...' : 'Save'}
          </button>
          <button type="button" className="remove-btn" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        {error && <p className="status error">{error}</p>}
      </li>
    )
  }

  return (
    <li>
      <div>
        <span className="txn-amount">
          -{Number(t.amount).toFixed(2)} {t.currency}
          {t.currency !== baseCurrency && (
            <span className="txn-converted">
              {' '}
              (≈{(t.amount * t.exchange_rate_to_base).toFixed(2)} {baseCurrency})
            </span>
          )}
        </span>
        <span className="txn-meta">
          {t.categories?.name ?? 'Uncategorized'} · {t.members?.display_name}
        </span>
      </div>
      {t.note && <p className="txn-note">{t.note}</p>}
      {canManage && (
        <div className="txn-actions">
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="remove-btn" disabled={busy} onClick={remove}>
            Delete
          </button>
        </div>
      )}
    </li>
  )
}
