import { useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabaseClient'
import Login from './pages/Login'
import FamilySetup from './pages/FamilySetup'
import Dashboard from './pages/Dashboard'
import ResetPassword from './pages/ResetPassword'
import PwaStatus from './components/PwaStatus'

function Screens() {
  const { session, loading, passwordRecovery } = useAuth()
  // Remember which family this person belongs to so reopening the app skips the "Loading..." screen.
  const [cachedFam] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fw:famid') || 'null') } catch { return null }
  })
  const [checkingMembership, setCheckingMembership] = useState(!cachedFam)
  const [familyId, setFamilyId] = useState(cachedFam?.fid ?? null)

  useEffect(() => {
    if (!session) {
      setCheckingMembership(false)
      return
    }

    let cancelled = false
    const hasCache = cachedFam && cachedFam.uid === session.user.id
    async function checkMembership() {
      if (hasCache) setFamilyId(cachedFam.fid)
      else setCheckingMembership(true)
      try {
        const { data, error } = await supabase
          .from('members')
          .select('family_id')
          .eq('user_id', session.user.id)
          .is('removed_at', null)
          .limit(1)
          .maybeSingle()
        if (error) throw error
        if (!cancelled) setFamilyId(data?.family_id ?? null)
        try {
          if (data?.family_id) localStorage.setItem('fw:famid', JSON.stringify({ uid: session.user.id, fid: data.family_id }))
          else localStorage.removeItem('fw:famid')
        } catch { /* ignore */ }
      } catch {
        // If this fails (network blip, RLS hiccup, etc.) don't leave the
        // person stuck on a loading screen forever — treat it as "no
        // family yet" so they land somewhere with a working Sign Out button.
        if (!cancelled && !hasCache) setFamilyId(null)
      } finally {
        if (!cancelled) setCheckingMembership(false)
      }
    }
    checkMembership()
    return () => {
      cancelled = true
    }
  }, [session?.user?.id])

  if (passwordRecovery) return <ResetPassword />

  if (loading || checkingMembership) {
    return (
      <div className="loading-screen">
        <p className="status">Loading...</p>
        {session && (
          <button type="button" className="link-btn" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        )}
      </div>
    )
  }

  if (!session) return <Login />
  if (!familyId) return <FamilySetup onFamilyReady={setFamilyId} />
  return <Dashboard familyId={familyId} />
}

export default function App() {
  return (
    <>
      <Screens />
      <PwaStatus />
    </>
  )
}
