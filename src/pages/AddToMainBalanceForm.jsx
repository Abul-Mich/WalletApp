import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { getExchangeRate, SUPPORTED_CURRENCIES } from '../lib/exchangeRates'

// Self-serve: moves money from the member's own held balance back into the
// shared family balance. Mirrors MemberBalanceTransfer, just inserting a
// negative amount — recalc_member_balance() and the wallet trigger handle
// both directions from the same table. Multi-currency: the entered amount
// is converted to the family's base currency before being checked against
// the member's current balance, same as every other balance figure in
// the app.
export default function AddToMainBalanceForm({ familyId, memberId, baseCurrency, currentBalance, onDone }) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(baseCurrency)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)

    try {
      const rate = await getExchangeRate(familyId, currency, baseCurrency)
      const parsed = parseFloat(amount)
      const baseAmount = parsed * rate

      if (baseAmount > currentBalance) {
        setError(`You only have ${Number(currentBalance).toFixed(2)} ${baseCurrency} to return.`)
        setBusy(false)
        return
      }

      const { error: err } = await supabase.from('member_balance_transfers').insert({
        family_id: familyId,
        member_id: memberId,
        amount: -parsed,
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
      <button type="submit" disabled={busy || currentBalance <= 0}>
        {busy ? 'Adding...' : 'Return to Family Balance'}
      </button>
      {currentBalance <= 0 && !error && (
        <p className="hint">You don't have any balance to return right now.</p>
      )}
      {error && <p className="status error">{error}</p>}
    </form>
  )
}
