import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function AdminSettings({ familyId, members, categories, baseCurrency, memberSpends, onDone }) {
  const [limitEdits, setLimitEdits] = useState({}) // memberId -> { amount, period }
  const [newCategory, setNewCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function editFor(member) {
    return (
      limitEdits[member.id] ?? {
        amount: member.spending_limit_amount ?? '',
        period: member.spending_limit_period ?? 'monthly'
      }
    )
  }

  function updateEdit(memberId, patch) {
    setLimitEdits((prev) => ({ ...prev, [memberId]: { ...editFor({ id: memberId }), ...patch } }))
  }

  async function saveLimit(member) {
    setBusy(true)
    setError(null)
    try {
      const edit = editFor(member)
      const { error: err } = await supabase
        .from('members')
        .update({
          spending_limit_amount: edit.amount === '' ? null : parseFloat(edit.amount),
          spending_limit_period: edit.amount === '' ? null : edit.period
        })
        .eq('id', member.id)
      if (err) throw err
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function addCategory(e) {
    e.preventDefault()
    if (!newCategory.trim()) return
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase
        .from('categories')
        .insert({ family_id: familyId, name: newCategory.trim(), is_default: false })
      if (err) throw err
      setNewCategory('')
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeCategory(categoryId) {
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.from('categories').delete().eq('id', categoryId)
      if (err) throw err
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="subsection">Family Limit Status</h3>
      {members.every((m) => !m.spending_limit_amount) && (
        <p className="hint">No members have a limit set yet.</p>
      )}
      {members
        .filter((m) => m.spending_limit_amount)
        .map((m) => {
          const spend = memberSpends?.[m.id]
          if (!spend) return null
          const pct = Math.min(spend.percentUsed * 100, 100)
          return (
            <div key={m.id} className="status-row">
              <div className="breakdown-row">
                <span>{m.display_name}</span>
                <span>
                  {spend.spent.toFixed(2)} / {spend.limit.toFixed(2)} {baseCurrency} ({spend.period})
                </span>
              </div>
              <div className="breakdown-bar-track">
                <div
                  className={`breakdown-bar ${spend.isOverLimit ? 'over' : spend.isNearLimit ? 'near' : ''}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}

      <h3 className="subsection">Per-Member Spending Limits</h3>
      {members.map((m) => {
        const edit = editFor(m)
        return (
          <div key={m.id} className="limit-row">
            <span className="limit-name">{m.display_name}</span>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="No limit"
              value={edit.amount}
              onChange={(e) => updateEdit(m.id, { amount: e.target.value })}
            />
            <select value={edit.period} onChange={(e) => updateEdit(m.id, { period: e.target.value })}>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
            </select>
            <span className="limit-currency">{baseCurrency}</span>
            <button type="button" disabled={busy} onClick={() => saveLimit(m)}>
              Save
            </button>
          </div>
        )
      })}

      <h3 className="subsection">Categories</h3>
      <ul className="category-list">
        {categories.map((c) => (
          <li key={c.id}>
            <span>{c.name}</span>
            {!c.is_default && (
              <button type="button" className="remove-btn" onClick={() => removeCategory(c.id)}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={addCategory} className="inline-form">
        <input
          placeholder="New category name"
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Add Category
        </button>
      </form>

      {error && <p className="status error">{error}</p>}
    </div>
  )
}
