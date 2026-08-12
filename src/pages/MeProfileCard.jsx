import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function MeProfileCard({ myMember, session, family, myRole, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(myMember?.display_name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!myMember) return null

  async function save() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === myMember.display_name) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase
        .from('members')
        .update({ display_name: trimmed })
        .eq('id', myMember.id)
      if (err) throw err
      setEditing(false)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Profile</h2>

      <div className="profile-field">
        <span className="profile-field-label">Name</span>
        {editing ? (
          <div className="inline-form">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              disabled={busy}
              autoFocus
            />
            <button type="button" onClick={save} disabled={busy}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        ) : (
          <div className="profile-field-row">
            <span>{myMember.display_name}</span>
            <button type="button" className="link-button" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        )}
      </div>
      {error && <p className="status error">{error}</p>}

      <div className="profile-field">
        <span className="profile-field-label">Email</span>
        <span>{session?.user?.email}</span>
      </div>

      <div className="profile-field">
        <span className="profile-field-label">Role</span>
        <span className={`profile-role ${myRole}`}>{myRole}</span>
      </div>

      <div className="profile-field">
        <span className="profile-field-label">Family</span>
        <span>{family?.name}</span>
      </div>

      <div className="profile-field">
        <span className="profile-field-label">Base Currency</span>
        <span>{family?.base_currency}</span>
      </div>
    </section>
  )
}
