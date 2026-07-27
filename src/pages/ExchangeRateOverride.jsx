import { useState } from 'react'
import { SUPPORTED_CURRENCIES, setManualOverride } from '../lib/exchangeRates'

export default function ExchangeRateOverride({ familyId, memberId, baseCurrency, onDone }) {
  const foreignCurrencies = SUPPORTED_CURRENCIES.filter((c) => c !== baseCurrency)
  const [fromCurrency, setFromCurrency] = useState(foreignCurrencies[0] ?? '')
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      await setManualOverride(familyId, memberId, fromCurrency, baseCurrency, parseFloat(rate))
      setStatus(`Set: 1 ${fromCurrency} = ${rate} ${baseCurrency} (today only)`)
      setRate('')
      onDone?.()
    } catch (err) {
      setStatus(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (foreignCurrencies.length === 0) return null

  return (
    <form onSubmit={handleSubmit} className="inline-form">
      <select value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value)}>
        {foreignCurrencies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span className="rate-eq">→ {baseCurrency}</span>
      <input
        type="number"
        step="0.0001"
        min="0.0001"
        placeholder={`Rate (e.g. 89500)`}
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        required
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Setting...' : 'Set Today\u2019s Rate'}
      </button>
      {status && <p className="status">{status}</p>}
    </form>
  )
}
