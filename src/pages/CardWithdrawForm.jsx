import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { getExchangeRate, SUPPORTED_CURRENCIES } from '../lib/exchangeRates'

// Logs a withdrawal/spend against a shared prepaid card — draws from the
// card's own balance, unrelated to any member's personal spending limit.
// No category, per the current spec (may be added later).
export default function CardWithdrawForm({ familyId, memberId, cardId, baseCurrency, currentBalance, onDone }) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(baseCurrency)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const rate = await getExchangeRate(familyId, currency, baseCurrency)
      const parsed = parseFloat(amount)

      if (parsed * rate > currentBalance) {
        setError(`This card only has ${Number(currentBalance).toFixed(2)} ${baseCurrency} left.`)
        setBusy(false)
        return
      }

      const { error: err } = await supabase.from('card_transactions').insert({
        family_id: familyId,
        card_id: cardId,
        member_id: memberId,
        amount: parsed,
        currency,
        exchange_rate_to_base: rate,
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
      <input
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="submit" disabled={busy || currentBalance <= 0}>
        {busy ? 'Logging...' : 'Withdraw from Card'}
      </button>
      {currentBalance <= 0 && !error && <p className="hint">This card is empty.</p>}
      {error && <p className="status error">{error}</p>}
    </form>
  )
}
