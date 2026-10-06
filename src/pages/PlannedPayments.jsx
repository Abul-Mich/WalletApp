import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { getExchangeRate } from '../lib/exchangeRates'
import { createExpense, latestLbpRate } from '../lib/wallets'

const BILL_CURRENCIES = ['USD', 'LBP']

function addPeriod(dateStr, recurrence) {
  const d = new Date(dateStr)
  if (recurrence === 'weekly') d.setDate(d.getDate() + 7)
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1)
  return d.toISOString().slice(0, 10)
}

function daysUntil(dateStr) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr)
  return Math.round((due - today) / (1000 * 60 * 60 * 24))
}

export default function PlannedPayments({
  familyId,
  memberId,
  categories,
  payments,
  onDone
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [recurrence, setRecurrence] = useState('monthly')
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleAdd(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const rate = await getExchangeRate(familyId, currency, 'USD')
      const { error: err } = await supabase.from('planned_payments').insert({
        family_id: familyId,
        created_by_member_id: memberId,
        name: name.trim(),
        amount: parseFloat(amount),
        currency,
        exchange_rate_to_base: rate,
        category_id: categoryId || null,
        recurrence,
        next_due_date: dueDate
      })
      if (err) throw err
      setName('')
      setAmount('')
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Logs the payment as a real transaction (so it hits the wallet balance and
  // category breakdown like any other expense), then either advances the due
  // date to the next period or deactivates it if it was a one-time bill.
  async function markPaid(payment) {
    setBusy(true)
    setError(null)
    try {
      // Logged as a normal expense from the member's own wallet. USD bills pay
      // from the USD wallet, LBP bills from the LBP wallet at today's rate.
      // (Old EUR/GBP bills are converted to USD at today's rate.)
      const cur = payment.currency
      let legs, lbpRate = null, original = Number(payment.amount)
      if (cur === 'LBP') {
        lbpRate = await latestLbpRate(familyId)
        if (!lbpRate) throw new Error('Set the LBP exchange rate in Settings first.')
        legs = [{ currency: 'LBP', amount: -original }]
      } else if (cur === 'USD') {
        legs = [{ currency: 'USD', amount: -original }]
      } else {
        const r = await getExchangeRate(familyId, cur, 'USD')
        legs = [{ currency: 'USD', amount: -Math.round(original * r * 10000) / 10000 }]
      }
      await createExpense({
        memberId,
        categoryId: payment.category_id,
        note: `Bill: ${payment.name}`,
        legs,
        lbpPerUsd: lbpRate,
        originalAmount: original,
        originalCurrency: cur,
      })

      if (payment.recurrence === 'one_time') {
        const { error: updErr } = await supabase
          .from('planned_payments')
          .update({ is_active: false })
          .eq('id', payment.id)
        if (updErr) throw updErr
      } else {
        const { error: updErr } = await supabase
          .from('planned_payments')
          .update({ next_due_date: addPeriod(payment.next_due_date, payment.recurrence) })
          .eq('id', payment.id)
        if (updErr) throw updErr
      }
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function removePayment(paymentId) {
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.from('planned_payments').delete().eq('id', paymentId)
      if (err) throw err
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const sorted = [...payments].sort(
    (a, b) => new Date(a.next_due_date) - new Date(b.next_due_date)
  )

  return (
    <div>
      {sorted.length === 0 && <p className="hint">No upcoming bills yet.</p>}
      <ul className="bill-list">
        {sorted.map((p) => {
          const days = daysUntil(p.next_due_date)
          const status = days < 0 ? 'overdue' : days <= 3 ? 'soon' : ''
          return (
            <li key={p.id} className={`bill-row ${status}`}>
              <div className="breakdown-row">
                <span>
                  {p.name}{' '}
                  <span className="txn-meta">
                    ({p.recurrence === 'one_time' ? 'one-time' : p.recurrence})
                  </span>
                </span>
                <span>
                  {Number(p.amount).toFixed(2)} {p.currency}
                </span>
              </div>
              <div className="bill-meta">
                <span>
                  {days < 0
                    ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
                    : days === 0
                      ? 'Due today'
                      : `Due in ${days} day${days === 1 ? '' : 's'}`}{' '}
                  ({p.next_due_date})
                </span>
                <div className="bill-actions">
                  <button type="button" disabled={busy} onClick={() => markPaid(p)}>
                    Mark Paid
                  </button>
                  <button
                    type="button"
                    className="remove-btn"
                    disabled={busy}
                    onClick={() => removePayment(p.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <h3 className="subsection">Add a Bill</h3>
      <form onSubmit={handleAdd} className="inline-form">
        <input
          placeholder="Name (e.g. Rent, Internet)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
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
          {BILL_CURRENCIES.map((c) => (
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
        <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
          <option value="one_time">One-time</option>
        </select>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        <button type="submit" disabled={busy}>
          {busy ? 'Adding...' : 'Add Bill'}
        </button>
        {error && <p className="status error">{error}</p>}
      </form>
    </div>
  )
}
