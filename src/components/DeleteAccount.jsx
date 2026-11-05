import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { EditSheet } from './RecordFields'

// "Delete my account": removes the login and personal details. The family keeps its history, with
// this person shown as "Former member". If they are the last member, the family is deleted too.
export default function DeleteAccount({ familyName }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function close() {
    if (busy) return
    setOpen(false)
    setTyped('')
    setError(null)
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('delete_my_account')
    if (err) {
      setBusy(false)
      setError(err.message)
      return
    }
    // The login no longer exists on the server; clear it on this phone too.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
    try { localStorage.clear() } catch { /* ignore */ }
    window.location.reload()
  }

  return (
    <>
      <section className="card danger-zone">
        <h2>Delete account</h2>
        <p className="hint">
          Erases your login, email and name for good. Your past records stay in {familyName || 'the family'}'s
          history as "Former member".
        </p>
        <button type="button" className="btn btn-danger btn-block" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      </section>

      {open && (
        <EditSheet title="Delete your account?" onClose={close}>
          <div className="sf-body">
            <p className="hint">This cannot be undone. Before you continue:</p>
            <ul className="hint" style={{ paddingLeft: 18, margin: '4px 0 10px' }}>
              <li>Your wallets must be empty. Move any money back to the pool first.</li>
              <li>If you are the superadmin, another admin takes over your role. Make one first.</li>
              <li>If you are the last member, the whole family and its data are deleted.</li>
            </ul>
            <label className="hint" htmlFor="del-confirm">Type DELETE to confirm</label>
            <input
              id="del-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="DELETE"
            />
            {error && <p className="status error">{error}</p>}
          </div>
          <div className="sf-footer sf-footer-stack">
            <button
              type="button"
              className="btn btn-primary btn-block sf-submit"
              style={{ background: 'var(--danger)' }}
              onClick={confirm}
              disabled={busy || typed.trim().toUpperCase() !== 'DELETE'}
            >
              {busy ? 'Deleting...' : 'Delete my account'}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={close} disabled={busy}>Cancel</button>
          </div>
        </EditSheet>
      )}
    </>
  )
}
