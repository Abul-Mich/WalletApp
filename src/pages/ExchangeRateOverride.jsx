import { useState } from 'react'
import { SUPPORTED_CURRENCIES, setManualOverride } from '../lib/exchangeRates'

export default function ExchangeRateOverride({ familyId, memberId, baseCurrency, onDone }) {
  const [fromCurrency, setFromCurrency] = useState(
    SUPPORTED_CURRENCIES.find((c) => c !== baseCurrency) ?? SUPPORTED_CURRENCIES[0]
  )
  const [toCurrency, setToCurrency] = useState(baseCurrency)
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus(null)

    if (fromCurrency === toCurrency) {
      setStatus('Pick two different currencies.')
      return
    }

    setBusy(true)
    try {
      // Stores this exact direction plus the auto-derived inverse — either
      // direction can be entered here, both become usable everywhere in the
      // app (deposits, expenses, bills always look up whatever direction
      // they need, so this doesn't have to match base currency at all).
      await setManualOverride(familyId, memberId, fromCurrency, toCurrency, parseFloat(rate))
      setStatus(`Set: 1 ${fromCurrency} = ${rate} ${toCurrency} (and the reverse rate) — in effect until changed`)
      setRate('')
      onDone?.()
    } catch (err) {
      setStatus(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="inline-form">
      <span>1</span>
      <select value={fromCurrency} onChange={(e) => setFromCurrency(e.target.value)}>
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <span className="rate-eq">=</span>
      <input
        type="number"
        step="0.0001"
        min="0.0001"
        placeholder="Rate (e.g. 89500)"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
        required
      />
      <select value={toCurrency} onChange={(e) => setToCurrency(e.target.value)}>
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy}>
        {busy ? 'Setting...' : 'Set Today\u2019s Rate'}
      </button>
      {status && <p className="status">{status}</p>}
    </form>
  )
}
