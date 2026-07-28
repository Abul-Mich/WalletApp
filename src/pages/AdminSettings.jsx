import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function AdminSettings({
  familyId,
  family,
  members,
  categories,
  baseCurrency,
  memberSpends,
  amSuperadmin,
  myMemberId,
  onDone
}) {
  const [limitEdits, setLimitEdits] = useState({}) // memberId -> { amount, period }
  const [catEdits, setCatEdits] = useState({}) // categoryId -> { amount, period }
  const [familyBudget, setFamilyBudget] = useState({
    amount: family.budget_amount ?? '',
    period: family.budget_period ?? 'monthly'
  })
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

  function catEditFor(cat) {
    return catEdits[cat.id] ?? { amount: cat.budget_amount ?? '', period: cat.budget_period ?? 'monthly' }
  }

  function updateCatEdit(catId, patch) {
    setCatEdits((prev) => ({ ...prev, [catId]: { ...catEditFor({ id: catId }), ...patch } }))
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

  async function saveFamilyBudget(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase
        .from('families')
        .update({
          budget_amount: familyBudget.amount === '' ? null : parseFloat(familyBudget.amount),
          budget_period: familyBudget.amount === '' ? null : familyBudget.period
        })
        .eq('id', familyId)
      if (err) throw err
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveCategoryBudget(cat) {
    setBusy(true)
    setError(null)
    try {
      const edit = catEditFor(cat)
      const { error: err } = await supabase
        .from('categories')
        .update({
          budget_amount: edit.amount === '' ? null : parseFloat(edit.amount),
          budget_period: edit.amount === '' ? null : edit.period
        })
        .eq('id', cat.id)
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

  async function changeRole(member, newRole) {
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.from('members').update({ role: newRole }).eq('id', member.id)
      if (err) throw err
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeMember(member) {
    if (!confirm(`Remove ${member.display_name} from the family?`)) return
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.from('members').delete().eq('id', member.id)
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
      <h3 className="subsection">Family Budget</h3>
      <p className="hint">
        A target for the family's overall spending this period — separate from the actual
        cash balance.
      </p>
      <form onSubmit={saveFamilyBudget} className="inline-form">
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="No budget set"
          value={familyBudget.amount}
          onChange={(e) => setFamilyBudget((prev) => ({ ...prev, amount: e.target.value }))}
        />
        <select
          value={familyBudget.period}
          onChange={(e) => setFamilyBudget((prev) => ({ ...prev, period: e.target.value }))}
        >
          <option value="weekly">weekly</option>
          <option value="monthly">monthly</option>
        </select>
        <span className="limit-currency">{baseCurrency}</span>
        <button type="submit" disabled={busy}>
          Save Budget
        </button>
      </form>

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

      <h3 className="subsection">Categories &amp; Category Budgets</h3>
      <ul className="category-list">
        {categories.map((c) => {
          const edit = catEditFor(c)
          return (
            <li key={c.id} className="category-budget-row">
              <div className="category-budget-header">
                <span>{c.name}</span>
                {!c.is_default && (
                  <button type="button" className="remove-btn" onClick={() => removeCategory(c.id)}>
                    ✕
                  </button>
                )}
              </div>
              <div className="limit-row">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="No budget"
                  value={edit.amount}
                  onChange={(e) => updateCatEdit(c.id, { amount: e.target.value })}
                />
                <select
                  value={edit.period}
                  onChange={(e) => updateCatEdit(c.id, { period: e.target.value })}
                >
                  <option value="weekly">weekly</option>
                  <option value="monthly">monthly</option>
                </select>
                <span className="limit-currency">{baseCurrency}</span>
                <button type="button" disabled={busy} onClick={() => saveCategoryBudget(c)}>
                  Save
                </button>
              </div>
            </li>
          )
        })}
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

      {amSuperadmin && (
        <>
          <h3 className="subsection">Manage Admins</h3>
          <p className="hint">
            Only you (the superadmin) can promote members to admin or demote admins back to
            member. The superadmin role itself can't be transferred or removed here.
          </p>
          {members
            .filter((m) => m.role !== 'superadmin')
            .map((m) => (
              <div key={m.id} className="limit-row">
                <span className="limit-name">{m.display_name}</span>
                <span className={`badge ${m.role}`}>{m.role}</span>
                {m.role === 'member' ? (
                  <button type="button" disabled={busy} onClick={() => changeRole(m, 'admin')}>
                    Promote to Admin
                  </button>
                ) : (
                  <button type="button" disabled={busy} onClick={() => changeRole(m, 'member')}>
                    Demote to Member
                  </button>
                )}
                {m.id !== myMemberId && (
                  <button
                    type="button"
                    className="remove-btn"
                    disabled={busy}
                    onClick={() => removeMember(m)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
        </>
      )}

      {error && <p className="status error">{error}</p>}
    </div>
  )
}
