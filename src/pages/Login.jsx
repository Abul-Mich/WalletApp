import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { getInvite } from '../lib/invite'
import '../styles/auth.css'

const GoogleLogo = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.5z" />
    <path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z" />
    <path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.8V7.1H2.7a10 10 0 0 0 0 9.2z" />
    <path fill="#EA4335" d="M12 5.9c1.5 0 2.9.5 4 1.6l3-3A10 10 0 0 0 2.7 7.1l3.5 2.7C7 7.7 9.3 5.9 12 5.9z" />
  </svg>
)

export default function Login() {
  const [step, setStep] = useState('hero') // hero | email | code | password | forgot | resetSent
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [isSignup, setIsSignup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sentKind, setSentKind] = useState('link') // link | confirm
  const [error, setError] = useState(null)
  const [cooldown, setCooldown] = useState(0)
  const invited = !!getInvite()

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  function go(next) {
    setError(null)
    setStep(next)
  }

  async function google() {
    setError(null)
    setBusy(true)
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
    if (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function sendLink(e) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin }
    })
    setBusy(false)
    if (err) return setError(err.message)
    setSentKind('link')
    setCooldown(30)
    setStep('sent')
  }

  async function passwordAuth(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const creds = { email: email.trim(), password }
    if (!isSignup) {
      const { error: err } = await supabase.auth.signInWithPassword(creds)
      setBusy(false)
      if (err) setError(err.message)
      return
    }
    const { data, error: err } = await supabase.auth.signUp({
      ...creds,
      options: { emailRedirectTo: window.location.origin }
    })
    setBusy(false)
    if (err) return setError(err.message)
    // Signed up and confirmed already: the session arrives on its own and the app moves on.
    if (data.session) return
    // Supabase hides existing accounts by returning a user with no identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setError('This email already has an account. Log in instead.')
      setIsSignup(false)
      return
    }
    setSentKind('confirm')
    setCooldown(30)
    setStep('sent')
  }

  async function resendConfirm() {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin }
    })
    setBusy(false)
    if (err) return setError(err.message)
    setCooldown(30)
  }

  async function forgot(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin
    })
    setBusy(false)
    if (err) return setError(err.message)
    setStep('resetSent')
  }

  if (step === 'hero') {
    return (
      <div className="au">
        <div className="au-glow" aria-hidden="true" />
        <div className="au-main">
          {invited && <div className="au-invite">You were invited to a family</div>}
          <div className="au-preview" aria-hidden="true">
            <div className="au-card-back" />
            <div className="au-card">
              <span className="au-card-label">Family money</span>
              <span className="au-card-total">$2,480</span>
              <div className="au-chips">
                <span>Pool $1,200</span>
                <span>Rim $340</span>
                <span>Karim $90</span>
              </div>
            </div>
            <div className="au-toast"><i /> Electricity paid, $48</div>
          </div>
          <h1 className="au-title">{invited ? 'Join your family wallet.' : "Your family's money, in one place."}</h1>
          <p className="au-sub">Shared pool, personal wallets and limits that keep it calm.</p>
        </div>
        <div className="au-bottom">
          <button type="button" className="au-btn au-btn-light" onClick={google} disabled={busy}>
            <GoogleLogo /> Continue with Google
          </button>
          <button type="button" className="au-btn au-btn-ghost" onClick={() => go('email')}>
            Continue with email
          </button>
          {error && <p className="au-error">{error}</p>}
        </div>
      </div>
    )
  }

  if (step === 'resetSent' || step === 'sent') {
    return (
      <div className="au">
        <div className="au-top" />
        <div className="au-main au-main-end">
          <h1 className="au-title">Check your email.</h1>
          <p className="au-sub">
            {step === 'sent'
              ? sentKind === 'confirm'
                ? `Account created. We sent a confirmation link to ${email.trim()}. Tap it to finish and you're in.`
                : `We sent a sign-in link to ${email.trim()}. Open it on this phone and you're in.`
              : 'We sent a link to reset your password.'}
          </p>
          {step === 'sent' && (
            <button type="button" className="au-link" onClick={sentKind === 'confirm' ? resendConfirm : sendLink} disabled={cooldown > 0 || busy}>
              {cooldown > 0 ? `Send a new link in ${cooldown}s` : 'Send a new link'}
            </button>
          )}
          {error && <p className="au-error">{error}</p>}
        </div>
        <div className="au-bottom">
          {step === 'sent' ? (
            <button type="button" className="au-btn au-btn-primary" onClick={() => go(sentKind === 'confirm' ? 'password' : 'email')}>{sentKind === 'confirm' ? 'Back to log in' : 'Use a different email'}</button>
          ) : (
            <button type="button" className="au-btn au-btn-primary" onClick={() => go('password')}>Back to log in</button>
          )}
        </div>
      </div>
    )
  }

  const titles = {
    email: ["What's your email?", "We'll email you a link. Tap it and you're in, no password to remember."],
    password: [isSignup ? 'Create your account.' : 'Welcome back.', isSignup ? 'Choose a password with at least 6 characters.' : 'Log in with your email and password.'],
    forgot: ['Reset your password.', "Enter your email and we'll send you a reset link."]
  }[step]

  const back = () => go(step === 'forgot' ? 'password' : 'hero')
  const submit = step === 'email' ? sendLink : step === 'password' ? passwordAuth : forgot
  const cta = {
    email: busy ? 'Sending...' : 'Email me a link',
    password: busy ? 'Working...' : isSignup ? 'Create account' : 'Log in',
    forgot: busy ? 'Sending...' : 'Send reset link'
  }[step]

  return (
    <form className="au" onSubmit={submit}>
      <div className="au-top">
        <button type="button" className="au-back" onClick={back} aria-label="Back">&#8592;</button>
      </div>
      <div className="au-main au-main-end">
        <h1 className="au-title au-title-sm">{titles[0]}</h1>
        <p className="au-sub">{titles[1]}</p>

        {(
          <input
            className="au-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus={step === 'email' || step === 'forgot'}
          />
        )}

        {step === 'password' && (
          <div className="au-pw">
            <input
              className="au-input"
              type={showPw ? 'text' : 'password'}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder="Password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
            <button type="button" className="au-pw-toggle" onClick={() => setShowPw(!showPw)}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
        )}

        {step === 'password' && (
          <div className="au-row">
            <button type="button" className="au-link" onClick={() => { setIsSignup(!isSignup); setError(null) }}>
              {isSignup ? 'I already have an account' : 'Create an account'}
            </button>
            {!isSignup && <button type="button" className="au-link" onClick={() => go('forgot')}>Forgot password?</button>}
          </div>
        )}

        {step === 'email' && (
          <button type="button" className="au-link" onClick={() => go('password')}>Use a password instead</button>
        )}

        {error && <p className="au-error">{error}</p>}
      </div>
      <div className="au-bottom">
        <button type="submit" className="au-btn au-btn-primary" disabled={busy}>{cta}</button>
      </div>
    </form>
  )
}
