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
      const { data } = await supabase
        .from('members')
        .select('family_id')
        .eq('user_id', session.user.id)
        .limit(1)
        .maybeSingle()
      if (!cancelled) {
        setFamilyId(data?.family_id ?? null)
        setCheckingMembership(false)
      }
    }
    checkMembership()
    return () => {
      cancelled = true
    }
  }, [session])

  if (loading || checkingMembership) {
    return <p className="status">Loading...</p>
  }

  if (!session) return <Login />
  if (!familyId) return <FamilySetup onFamilyReady={setFamilyId} />
  return <Dashboard familyId={familyId} />
}
