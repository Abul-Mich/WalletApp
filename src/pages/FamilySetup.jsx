import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { createFamily, joinFamily } from '../lib/wallets'

const DEFAULT_CATEGORIES = ['Groceries', 'School', 'Entertainment', 'Medical', 'Other']

export default function FamilySetup({ onFamilyReady }) {
  const [tab, setTab] = useState('create') // 'create' | 'join'
  const [familyName, setFamilyName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreateFamily(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // One database function creates the family, your admin membership,
      // the family pool and your two wallets (USD + LBP) together.
      const family = await createFamily({ name: familyName, displayName })
      const { error: catErr } = await supabase.from('categories').insert(
        DEFAULT_CATEGORIES.map((name) => ({ family_id: family.id, name, is_default: true }))
      )
      if (catErr) throw catErr
      onFamilyReady(family.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleJoinFamily(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const member = await joinFamily({ code: inviteCode.trim(), displayName })
      onFamilyReady(member.family_id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <h1>Set Up Your Family</h1>

      <div className="mode-toggle">
        <button className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>
          Create Family
        </button>
        <button className={tab === 'join' ? 'active' : ''} onClick={() => setTab('join')}>
          Join with Code
        </button>
      </div>

      {tab === 'create' ? (
        <form onSubmit={handleCreateFamily}>
          <input
            placeholder="Family name (e.g. The Khourys)"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            required
          />
          <input
            placeholder="Your display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Creating...' : 'Create Family (become Superadmin)'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleJoinFamily}>
          <input
            placeholder="Invite code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
          />
          <input
            placeholder="Your display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Joining...' : 'Join Family'}
          </button>
        </form>
      )}

      {error && <p className="status error">{error}</p>}
    </div>
  )
}
