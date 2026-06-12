'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

const ADMIN_EMAIL = 'vinitvaru96@gmail.com'

interface AuthContextType {
  session: Session | null
  user: User | null
  loading: boolean
  isAdmin: boolean
  role: 'admin' | 'user'
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  isAdmin: false,
  role: 'user',
})

async function ensureProfile(user: User): Promise<'admin' | 'user'> {
  try {
    const { data: existing } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (existing) return existing.role as 'admin' | 'user'

    const role: 'admin' | 'user' = user.email === ADMIN_EMAIL ? 'admin' : 'user'
    await supabase.from('user_profiles').insert({
      id: user.id,
      email: user.email,
      role,
    })
    return role
  } catch {
    // user_profiles table may not exist yet (migration not applied)
    return user.email === ADMIN_EMAIL ? 'admin' : 'user'
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<'admin' | 'user'>('user')

  useEffect(() => {
    // When the stored access token is expired, Supabase blocks INITIAL_SESSION
    // until the refresh network request completes. If that request hangs the
    // spinner never clears. Pre-clearing the expired entry lets Supabase fire
    // INITIAL_SESSION with null immediately (no network call needed).
    try {
      const key = Object.keys(localStorage).find(
        k => k.startsWith('sb-') && k.endsWith('-auth-token')
      )
      if (key) {
        const stored = JSON.parse(localStorage.getItem(key) ?? '{}')
        if (stored.expires_at && stored.expires_at < Math.floor(Date.now() / 1000)) {
          localStorage.removeItem(key)
        }
      }
    } catch {
      // localStorage unavailable — bail timeout will handle it
    }

    const bail = setTimeout(() => setLoading(false), 5000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      clearTimeout(bail)
      setSession(session)
      setUser(session?.user ?? null)
      if (!session?.user) setRole('user')
      setLoading(false)
      if (session?.user) {
        const r = await ensureProfile(session.user)
        setRole(r)
      }
    })

    // Recover from a stale connection when returning to a backgrounded tab.
    // After being away a while, fire a quick health-check query. If it errors or
    // times out — the "stuck loading" state — hard-reload to rebuild the client
    // cleanly. This only runs on a hidden→visible transition, so it can't loop,
    // and it only reloads when a query genuinely fails (not on every return).
    let hiddenAt: number | null = null
    function onVisibility() {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
      const awayMs = hiddenAt ? Date.now() - hiddenAt : 0
      hiddenAt = null
      if (awayMs < 5000) return

      let settled = false
      const finish = (broken: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(probeTimeout)
        if (broken) {
          // Connection is dead — hard reload to rebuild the client cleanly.
          window.location.reload()
        } else {
          // Connection is healthy, but a request frozen during backgrounding may
          // have left a page stuck on its loading spinner. Tell pages to re-fire
          // their data load (a fresh query clears the stuck state), and refresh
          // the auth session in the background.
          window.dispatchEvent(new Event('vgarage:reconnected'))
          supabase.auth.getSession()
            .then(({ data: { session } }) => { setSession(session); setUser(session?.user ?? null) })
            .catch(() => {})
        }
      }
      const probeTimeout = setTimeout(() => finish(true), 5000)

      supabase.from('vehicles').select('id').limit(1)
        .then(({ error }) => finish(!!error), () => finish(true))
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearTimeout(bail)
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <AuthContext.Provider value={{ session, user, loading, isAdmin: role === 'admin', role }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
