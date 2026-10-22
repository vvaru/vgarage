'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { withRetry, withTimeout } from '@/lib/recover'
import { getCache, setCache } from '@/lib/cache'
import { useDataRefresh } from '@/components/shell/forms'
import type { FuelLog, ServiceCategory, ServiceCategoryProduct, ServiceLog } from '@/lib/types'

export interface CarData {
  categories: ServiceCategory[]
  services: ServiceLog[]      // newest first
  fuel: FuelLog[]             // newest first
  catalog: ServiceCategoryProduct[]
}

const EMPTY: CarData = { categories: [], services: [], fuel: [], catalog: [] }

/**
 * Everything Home needs about one car. Shows the last-loaded copy instantly
 * (cached per car), re-checks in the background, and reloads after any save.
 */
export function useCarData(vehicleId: string | undefined) {
  const [data, setData] = useState<CarData>(() => (vehicleId && getCache<CarData>(`car:${vehicleId}`)) || EMPTY)
  const [loading, setLoading] = useState(!data.services.length && !data.fuel.length)
  const [error, setError] = useState<string | null>(null)
  const loadedFor = useRef<string | null>(null)

  const load = useCallback(async () => {
    if (!vehicleId) return
    const key = `car:${vehicleId}`
    if (loadedFor.current !== vehicleId) {
      loadedFor.current = vehicleId
      const cached = getCache<CarData>(key)
      if (cached) { setData(cached); setLoading(false) } else setLoading(true)
    }
    try {
      const [cats, svc, fuel, cat] = await withRetry(() => withTimeout(Promise.all([
        supabase.from('service_categories').select('*').eq('vehicle_id', vehicleId).order('name'),
        supabase.from('service_logs').select('*').eq('vehicle_id', vehicleId).order('date', { ascending: false }),
        supabase.from('fuel_logs').select('*').eq('vehicle_id', vehicleId).order('date', { ascending: false }),
        supabase.from('service_category_products').select('*').eq('vehicle_id', vehicleId),
      ]), 10_000))
      const err = cats.error ?? svc.error ?? fuel.error
      if (err) throw new Error(err.message)
      const next: CarData = {
        categories: (cats.data ?? []) as ServiceCategory[],
        services: (svc.data ?? []) as ServiceLog[],
        fuel: (fuel.data ?? []) as FuelLog[],
        catalog: (cat.data ?? []) as ServiceCategoryProduct[],
      }
      setData(next)
      setCache(key, next)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load your data.')
    } finally {
      setLoading(false)
    }
  }, [vehicleId])

  useEffect(() => { load() }, [load])
  useDataRefresh(load)

  return { ...data, loading, error, reload: load }
}
