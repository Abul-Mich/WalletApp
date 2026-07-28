import { useState } from 'react'
import { supabase } from '../supabaseClient'

// Self-serve top-up: moves money from the shared family balance into the
// current member's own live balance. Always immediate (no approval step) —
// the server-side trigger checks there's enough unallocated family balance
// and notifies admins/superadmins.
export default function MemberBalanceTransfer({ familyId, memberId, baseCurrency, onDone }) {
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.from('member_balance_transfers').insert({
        family_id: familyId,
        member_id: memberId,
        amount: parseFloat(amount)
      })
      if (err) throw err
      setAmount('')
      onDone?.()
    } catch (err) {
      // The DB trigger raises a plain exception if there isn't enough
      // unallocated family balance — Supabase surfaces that as err.message.
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
        placeholder={`Amount (${baseCurrency})`}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        required
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Adding...' : 'Add to My Balance'}
      </button>
      {error && <p className="status error">{error}</p>}
    </form>
  )
}
