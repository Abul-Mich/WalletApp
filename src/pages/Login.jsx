import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('password') // 'password' | 'magic' | 'forgot'
  const [status, setStatus] = useState(null)
  const [isSignup, setIsSignup] = useState(false)

  async function handlePasswordAuth(e) {
    e.preventDefault()
    setStatus('Working...')
    const { error } = isSignup
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })
    setStatus(error ? error.message : null)
  }

  async function handleMagicLink(e) {
    e.preventDefault()
    setStatus('Sending link...')
    const { error } = await supabase.auth.signInWithOtp({ email })
    setStatus(error ? error.message : 'Check your email for the login link.')
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setStatus('Sending reset link...')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    })
    setStatus(
      error ? error.message : 'Check your email for a link to reset your password.'
    )
  }

  return (
    <div className="auth-screen">
      <h1>Family Wallet</h1>
      <p className="subtitle">Sign in to your family's shared wallet.</p>

      <div className="mode-toggle">
        <button className={mode === 'password' ? 'active' : ''} onClick={() => setMode('password')}>
          Email + Password
        </button>
        <button className={mode === 'magic' ? 'active' : ''} onClick={() => setMode('magic')}>
          Magic Link
        </button>
      </div>

      {mode === 'password' && (
        <form onSubmit={handlePasswordAuth}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button type="submit">{isSignup ? 'Create Account' : 'Log In'}</button>
          <button type="button" className="link-btn" onClick={() => setIsSignup(!isSignup)}>
            {isSignup ? 'Already have an account? Log in' : "New here? Create an account"}
          </button>
          {!isSignup && (
            <button type="button" className="link-btn" onClick={() => { setMode('forgot'); setStatus(null) }}>
              Forgot password?
            </button>
          )}
        </form>
      )}

      {mode === 'magic' && (
        <form onSubmit={handleMagicLink}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit">Send Magic Link</button>
        </form>
      )}

      {mode === 'forgot' && (
        <form onSubmit={handleForgotPassword}>
          <p className="subtitle">
            Enter your email and we'll send you a link to reset your password.
          </p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit">Send Reset Link</button>
          <button type="button" className="link-btn" onClick={() => { setMode('password'); setStatus(null) }}>
            Back to log in
          </button>
        </form>
      )}

      {status && <p className="status">{status}</p>}
    </div>
  )
}
