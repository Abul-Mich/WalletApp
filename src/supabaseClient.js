import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly in dev rather than silently making broken requests.
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env.local and fill in your project values.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  realtime: {
    params: {
      // Keep heartbeat traffic modest (default is fine, kept explicit for clarity — see NFR2).
      eventsPerSecond: 5
    }
  }
})

// Dev-only convenience: lets you run supabase.auth.getSession() etc. from the
// browser console for debugging. Harmless to leave in, but fine to remove later.
if (import.meta.env.DEV) {
  window.supabase = supabase
}
