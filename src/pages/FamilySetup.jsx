import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../AuthContext'

const DEFAULT_CATEGORIES = ['Groceries', 'School', 'Entertainment', 'Medical', 'Other']

function randomInviteCode() {
  // Short, human-typeable code (e.g. "7F3K9A")
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

export default function FamilySetup({ onFamilyReady }) {
  const { session } = useAuth()
  const [tab, setTab] = useState('create') // 'create' | 'join'
  const [familyName, setFamilyName] = useState('')
  const [baseCurrency, setBaseCurrency] = useState('USD')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleCreateFamily(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Generate IDs up front instead of using .select() after insert.
      // Why: insert().select() does an INSERT...RETURNING, and Postgres still
      // enforces the SELECT policy on the returned row. families_select requires
      // the caller to already be a member of that family — but at this exact
      // moment they aren't a member yet (that happens in step 2 below). Knowing
      // the id ahead of time sidesteps needing that read entirely.
      const familyId = crypto.randomUUID()
      const memberId = crypto.randomUUID()

      // 1. Create the family
      const { error: famErr } = await supabase
        .from('families')
        .insert({ id: familyId, name: familyName, base_currency: baseCurrency })
      if (famErr) throw famErr

      // 2. Add the current user as admin
      const { error: memErr } = await supabase.from('members').insert({
        id: memberId,
        family_id: familyId,
        user_id: session.user.id,
        display_name: displayName || session.user.email,
        role: 'admin',
        preferred_currency: baseCurrency
      })
      if (memErr) throw memErr

      // 3. Create the wallet
      const { error: walletErr } = await supabase
        .from('wallets')
        .insert({ family_id: familyId, balance_cache: 0 })
      if (walletErr) throw walletErr

      // 4. Seed default categories (FR11)
      const { error: catErr } = await supabase.from('categories').insert(
        DEFAULT_CATEGORIES.map((name) => ({ family_id: familyId, name, is_default: true }))
      )
      if (catErr) throw catErr

      // 5. Generate a first invite code so the admin has something to share immediately
      await supabase.from('family_invites').insert({
        family_id: familyId,
        code: randomInviteCode(),
        created_by_member_id: memberId
      })

      onFamilyReady(familyId)
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
      const code = inviteCode.trim().toUpperCase()

      const { data: invite, error: inviteErr } = await supabase
        .from('family_invites')
        .select('*')
        .eq('code', code)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .single()
      if (inviteErr || !invite) throw new Error('Invalid or expired invite code.')

      const { error: memErr } = await supabase.from('members').insert({
        family_id: invite.family_id,
        user_id: session.user.id,
        display_name: displayName || session.user.email,
        role: 'member',
        preferred_currency: 'USD'
      })
      if (memErr) throw memErr

      onFamilyReady(invite.family_id)
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
          />
          <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}>
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="LBP">LBP — Lebanese Pound</option>
          </select>
          <button type="submit" disabled={busy}>
            {busy ? 'Creating...' : 'Create Family (become Admin)'}
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
