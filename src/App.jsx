import { useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { supabase } from './supabaseClient'
import Login from './pages/Login'
import FamilySetup from './pages/FamilySetup'
import Dashboard from './pages/Dashboard'

export default function App() {
  const { session, loading } = useAuth()
  const [checkingMembership, setCheckingMembership] = useState(true)
  const [familyId, setFamilyId] = useState(null)

  useEffect(() => {
    if (!session) {
      setCheckingMembership(false)
      return
    }

    let cancelled = false
    async function checkMembership() {
      setCheckingMembership(true)
      try {
        const { data, error } = await supabase
          .from('members')
          .select('family_id')
          .eq('user_id', session.user.id)
          .limit(1)
          .maybeSingle()
        if (error) throw error
        if (!cancelled) setFamilyId(data?.family_id ?? null)
      } catch {
        // If this fails (network blip, RLS hiccup, etc.) don't leave the
        // person stuck on a loading screen forever — treat it as "no
        // family yet" so they land somewhere with a working Sign Out button.
        if (!cancelled) setFamilyId(null)
      } finally {
        if (!cancelled) setCheckingMembership(false)
      }
    }
    checkMembership()
    return () => {
      cancelled = true
    }
  }, [session])

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
