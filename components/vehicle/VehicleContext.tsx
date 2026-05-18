'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import type { Vehicle } from '@/lib/types'

interface VehicleContextType {
  vehicle: Vehicle | null
  loading: boolean
  refresh: () => Promise<void>
}

const VehicleContext = createContext<VehicleContextType>({
  vehicle: null,
  loading: true,
  refresh: async () => {},
})

export function VehicleProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const [vehicle, setVehicle] = useState<Vehicle | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!session) return
    setLoading(true)
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    setVehicle(data ?? null)
    setLoading(false)
  }, [session])

  useEffect(() => {
    if (session) {
      refresh()
    } else {
      setVehicle(null)
      setLoading(false)
    }
  }, [session, refresh])

  return (
    <VehicleContext.Provider value={{ vehicle, loading, refresh }}>
      {children}
    </VehicleContext.Provider>
  )
}

export function useVehicle() {
  return useContext(VehicleContext)
}
