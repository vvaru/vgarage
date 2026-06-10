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

    // When the tab regains focus after being idle, the stored access token may
    // have gone stale (browsers throttle the background auto-refresh timer).
    // Re-check the session so the next read/write uses a fresh token instead of
    // silently failing. getSession() refreshes the token if it's expired.
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      supabase.auth.getSession()
        .then(({ data: { session } }) => {
          setSession(session)
          setUser(session?.user ?? null)
          if (!session) window.location.replace('/login')
        })
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(bail)
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
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
