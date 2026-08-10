import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

export default function ResetPassword() {
  const { clearPasswordRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus(null)

    if (password !== confirm) {
      setStatus('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setStatus('Password must be at least 6 characters.')
      return
    }

    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (error) {
      setStatus(error.message)
      return
    }
    clearPasswordRecovery()
  }

  return (
    <div className="auth-screen">
      <h1>Set a New Password</h1>
      <p className="subtitle">Choose a new password for your account.</p>

      <form onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={6}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save Password'}
        </button>
      </form>

      {status && <p className="status">{status}</p>}
    </div>
  )
}
