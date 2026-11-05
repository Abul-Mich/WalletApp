import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'
import { createFamily, joinFamily } from '../lib/wallets'
import { getInvite, clearInvite } from '../lib/invite'
import '../styles/auth.css'

const DEFAULT_CATEGORIES = ['Groceries', 'School', 'Entertainment', 'Medical', 'Other']

export default function FamilySetup({ onFamilyReady }) {
  const { session } = useAuth()
  const invite = getInvite()
  const [tab, setTab] = useState(invite ? 'join' : 'create') // 'create' | 'join'
  const [familyName, setFamilyName] = useState('')
  const [displayName, setDisplayName] = useState(session?.user?.user_metadata?.full_name || '')
  const [inviteCode, setInviteCode] = useState(invite)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (tab === 'create') {
        // One database function creates the family, your admin membership,
        // the family pool and your two wallets (USD + LBP) together.
        const family = await createFamily({ name: familyName.trim(), displayName: displayName.trim() })
        const { error: catErr } = await supabase.from('categories').insert(
          DEFAULT_CATEGORIES.map((name) => ({ family_id: family.id, name, is_default: true }))
        )
        if (catErr) throw catErr
        clearInvite()
        onFamilyReady(family.id)
      } else {
        const member = await joinFamily({ code: inviteCode.trim(), displayName: displayName.trim() })
        clearInvite()
        onFamilyReady(member.family_id)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const joining = tab === 'join'

  return (
    <form className="au" onSubmit={handleSubmit}>
      <div className="au-top">
        <button type="button" className="au-back" onClick={() => supabase.auth.signOut()} aria-label="Sign out" title="Sign out">
          &#8592;
        </button>
      </div>
      <div className="au-main au-main-end">
        <h1 className="au-title au-title-sm">{joining ? 'Join your family.' : 'Start your family.'}</h1>
        <p className="au-sub">
          {joining ? 'Paste the invite code or open an invite link.' : 'Give it a name. You become its admin.'}
        </p>

        <input
          className="au-input au-input-plain"
          placeholder="Your name"
          aria-label="Your name"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />

        <div className="au-seg" role="tablist">
          <button type="button" role="tab" aria-selected={joining} className={joining ? 'on' : ''} onClick={() => setTab('join')}>
            Join with a code
          </button>
          <button type="button" role="tab" aria-selected={!joining} className={!joining ? 'on' : ''} onClick={() => setTab('create')}>
            Start a family
          </button>
        </div>

        {joining ? (
          <input
            className="au-input"
            placeholder="Invite code"
            aria-label="Invite code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
          />
        ) : (
          <input
            className="au-input"
            placeholder="The Khoury family"
            aria-label="Family name"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            required
          />
        )}

        {error && <p className="au-error">{error}</p>}
      </div>
      <div className="au-bottom">
        <button type="submit" className="au-btn au-btn-primary" disabled={busy}>
          {busy ? 'One moment...' : joining ? 'Join family' : 'Create family'}
        </button>
      </div>
    </form>
  )
}
