'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { Button, Icon, TextField } from '@/components/ui/md'

export default function LoginPage() {
  const { session } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (session) router.replace('/dashboard')
  }, [session, router])

  async function handleEmailAuth(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setMessage(null)

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setMessage('Check your email to confirm your account.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    }
    setLoading(false)
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    })
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-6">
      <div className="mb-8 text-center">
        <span className="w-16 h-16 rounded-2xl bg-primary-container text-on-primary-container flex items-center justify-center mx-auto mb-4">
          <Icon name="directions_car" size={36} />
        </span>
        <h1 className="type-headline-sm text-on-surface">vGarage</h1>
        <p className="type-body text-on-surface-variant mt-1">Your car. Tracked.</p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-5">
        <button type="button" onClick={handleGoogle}
          className="relative w-full h-12 flex items-center justify-center gap-3 rounded-full border border-outline text-on-surface type-label-lg overflow-hidden before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.08]">
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-outline-variant" />
          <span className="type-body text-on-surface-variant">or</span>
          <div className="flex-1 h-px bg-outline-variant" />
        </div>

        <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">
          <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
          <TextField label="Password" type="password" autoComplete={isSignUp ? 'new-password' : 'current-password'} required value={password} onChange={e => setPassword(e.target.value)} />

          {error && <p role="alert" className="type-body text-error">{error}</p>}
          {message && <p role="status" className="type-body text-[var(--md-success)]">{message}</p>}

          <Button type="submit" size="lg" loading={loading} className="w-full">{isSignUp ? 'Create account' : 'Sign in'}</Button>
        </form>

        <Button variant="text" className="self-center" onClick={() => { setIsSignUp(!isSignUp); setError(null); setMessage(null) }}>
          {isSignUp ? 'Already have an account? Sign in' : 'Don’t have an account? Sign up'}
        </Button>
      </div>
    </div>
  )
}
