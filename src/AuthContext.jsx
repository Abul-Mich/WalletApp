import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const AuthContext = createContext(null)

function readStoredSession() {
  try {
    const ref = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split('.')[0]
    const stored = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) || 'null')
    return stored?.user?.id && stored?.access_token ? stored : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  // Start from the session Supabase keeps in localStorage so a returning user does not wait on a "Loading..."
  // screen; getSession() below confirms (or refreshes) it right after.
  const [session, setSession] = useState(readStoredSession)
  const [loading, setLoading] = useState(() => !readStoredSession())
  // Set when the user lands back on the app from the "reset your password"
  // email link. Supabase fires this auth event once it exchanges that
  // link's token for a temporary session — we use it to show a "set new
  // password" screen instead of dropping them straight into the dashboard
  // with a session they didn't knowingly start.
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      if (event === 'SIGNED_OUT') {
        try { ['fw:fam', 'fw:famid', 'fw:view'].forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
      }
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider
      value={{ session, loading, passwordRecovery, clearPasswordRecovery: () => setPasswordRecovery(false) }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
