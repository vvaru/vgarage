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
    // Hard bail — loading can never hang longer than 5 seconds
    const bail = setTimeout(() => setLoading(false), 5000)

    // INITIAL_SESSION fires immediately from localStorage without waiting for
    // any token-refresh network call, so setLoading(false) fires right away.
    // If the stored token is expired, TOKEN_REFRESHED or SIGNED_OUT fires
    // silently in the background — no spinner involved.
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

    return () => {
      clearTimeout(bail)
      subscription.unsubscribe()
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
