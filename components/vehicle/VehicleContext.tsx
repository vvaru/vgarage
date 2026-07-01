'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { withRetry, withTimeout } from '@/lib/recover'
import type { Vehicle } from '@/lib/types'

const STORAGE_KEY = 'vgarage_active_vehicle_id'

interface VehicleContextType {
  vehicle: Vehicle | null
  vehicles: Vehicle[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  setActiveVehicleId: (id: string) => void
}

const VehicleContext = createContext<VehicleContextType>({
  vehicle: null,
  vehicles: [],
  loading: true,
  error: null,
  refresh: async () => {},
  setActiveVehicleId: () => {},
})

export function VehicleProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: qErr } = await withRetry(() => withTimeout(supabase
        .from('vehicles')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true }), 8000))
      if (qErr) { setError(qErr.message); return }

      const list = (data ?? []) as Vehicle[]
      setVehicles(list)
      setActiveId(prev => {
        if (prev && list.find(v => v.id === prev)) return prev
        const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
        if (stored && list.find(v => v.id === stored)) return stored
        return list[0]?.id ?? null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the database.')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (session) {
      refresh()
    } else {
      setVehicles([])
      setActiveId(null)
      setError(null)
      setLoading(false)
    }
  }, [session, refresh])

  function setActiveVehicleId(id: string) {
    setActiveId(id)
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, id)
  }

  const vehicle = vehicles.find(v => v.id === activeId) ?? null

  return (
    <VehicleContext.Provider value={{ vehicle, vehicles, loading, error, refresh, setActiveVehicleId }}>
      {children}
    </VehicleContext.Provider>
  )
}

export function useVehicle() {
  return useContext(VehicleContext)
}
