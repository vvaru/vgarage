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
    // Safety net: never block the app shell longer than 8s waiting for the
    // initial session. We do NOT pre-clear an expired token anymore — Supabase
    // refreshes it with the still-valid refresh token, so a reload recovers the
    // session instead of logging the user out.
    const bail = setTimeout(() => setLoading(false), 8000)

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

    // Returning to the tab after being away: the browser holds dead keep-alive
    // sockets to Supabase and there's no way to force fresh ones from JS, so the
    // next queries wedge. A reload is the only reliable way to get fresh
    // connections — but ONLY on return after a real absence (not mid-use), and the
    // refresh token keeps you signed in. Short switches just refresh data in place.
    const RELOAD_AFTER_MS = 15000
    let hiddenAt: number | null = null
    function onVisibility() {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
      const awayMs = hiddenAt ? Date.now() - hiddenAt : 0
      hiddenAt = null
      if (awayMs < 3000) return
      if (awayMs >= RELOAD_AFTER_MS) {
        window.location.reload()
      } else {
        window.dispatchEvent(new Event('vgarage:reconnected'))
        supabase.auth.getSession()
          .then(({ data: { session } }) => { setSession(session); setUser(session?.user ?? null) })
          .catch(() => {})
      }
    }
    // Mobile (esp. iOS Safari) freezes the page and restores it from the bfcache
    // on return — its connections are stale, so reload for a clean slate.
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) window.location.reload()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)

    return () => {
      clearTimeout(bail)
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
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
