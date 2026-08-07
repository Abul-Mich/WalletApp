import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { getExchangeRate, SUPPORTED_CURRENCIES } from '../lib/exchangeRates'

// Moves money from the family's unallocated balance onto a shared prepaid
// card. Any member can do this — the server-side trigger checks there's
// enough unallocated family balance (not already claimed by a member's own
// balance or another card).
export default function CardTopUpForm({ familyId, memberId, cardId, baseCurrency, onDone }) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(baseCurrency)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const rate = await getExchangeRate(familyId, currency, baseCurrency)
      const { error: err } = await supabase.from('card_transfers').insert({
        family_id: familyId,
        card_id: cardId,
        member_id: memberId,
        amount: parseFloat(amount),
        currency,
        exchange_rate_to_base: rate
      })
      if (err) throw err
      setAmount('')
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
      <button type="submit" disabled={busy}>
        {busy ? 'Adding...' : 'Top Up Card'}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  )
}
