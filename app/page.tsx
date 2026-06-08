'use client'

import { useEffect } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'

export default function Home() {
  const { session, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    window.location.replace(session ? '/dashboard' : '/login')
  }, [session, loading])

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
