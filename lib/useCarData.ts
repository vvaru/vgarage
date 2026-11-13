'use client'

import { useCallback, useEffect, useState } from 'react'
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
async function fetchCarData(vehicleId: string): Promise<CarData> {
  const [cats, svc, fuel, cat] = await withRetry(() => withTimeout(Promise.all([
    supabase.from('service_categories').select('*').eq('vehicle_id', vehicleId).order('name'),
    supabase.from('service_logs').select('*').eq('vehicle_id', vehicleId).order('date', { ascending: false }),
    supabase.from('fuel_logs').select('*').eq('vehicle_id', vehicleId).order('date', { ascending: false }),
    supabase.from('service_category_products').select('*').eq('vehicle_id', vehicleId),
  ]), 10_000))
  const err = cats.error ?? svc.error ?? fuel.error
  if (err) throw new Error(err.message)
  return {
    categories: (cats.data ?? []) as ServiceCategory[],
    services: (svc.data ?? []) as ServiceLog[],
    fuel: (fuel.data ?? []) as FuelLog[],
    catalog: (cat.data ?? []) as ServiceCategoryProduct[],
  }
}

export function useCarData(vehicleId: string | undefined) {
  // What's loaded is tagged with its car, so switching cars shows that car's
  // cached copy (or nothing) until its own data arrives, never the last car's.
  const [state, setState] = useState<{ vid: string; data: CarData } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  useDataRefresh(reload)

  useEffect(() => {
    if (!vehicleId) return
    let live = true
    fetchCarData(vehicleId)
      .then(next => {
        if (!live) return
        setCache(`car:${vehicleId}`, next)
        setState({ vid: vehicleId, data: next })
        setError(null)
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Couldn’t load your data.') })
    return () => { live = false }
  }, [vehicleId, tick])

  const fresh = state && state.vid === vehicleId ? state.data : null
  const cached = !fresh && vehicleId ? getCache<CarData>(`car:${vehicleId}`) : undefined
  return { ...(fresh ?? cached ?? EMPTY), loading: !fresh && !cached && !error, error, reload }
}
