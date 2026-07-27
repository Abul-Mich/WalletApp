import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { getExchangeRate, SUPPORTED_CURRENCIES } from '../lib/exchangeRates'

export default function TransactionForm({ familyId, memberId, baseCurrency, categories, onDone }) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(baseCurrency)
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const rate = await getExchangeRate(familyId, currency, baseCurrency)

      const { error: err } = await supabase.from('transactions').insert({
        family_id: familyId,
        member_id: memberId,
        amount: parseFloat(amount),
        currency,
        exchange_rate_to_base: rate,
        category_id: categoryId || null,
        note: note || null
      })
      if (err) throw err
      setAmount('')
      setNote('')
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inline-form">
      <input
        type="number"
        step="0.01"
        min="0.01"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
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
      <input
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Logging...' : 'Log Expense'}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  )
}
