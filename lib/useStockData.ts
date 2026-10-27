'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { read } from '@/lib/recover'
import { getCache, setCache } from '@/lib/cache'
import { useDataRefresh } from '@/components/shell/forms'
import { loadGarage, type GarageContext } from '@/lib/formData'
import type { ProductType } from '@/lib/productTypes'
import type { TireEvent } from '@/lib/tires'
import type { ProductLink, ServiceLog } from '@/lib/types'

export type LogRow = Pick<ServiceLog, 'id' | 'date' | 'service_type' | 'performed_by' | 'cost' | 'odometer'>

export interface StockData {
  garage: GarageContext
  types: ProductType[]
  buyLinks: ProductLink[]
  tireEvents: TireEvent[]
  logs: Map<string, LogRow>
}

async function fetchStock(userId: string, vehicleId: string, odo: number): Promise<StockData> {
  const [garage, t, l, e, logs] = await Promise.all([
    loadGarage(userId, vehicleId, odo),
    read(supabase.from('product_types').select('*').eq('user_id', userId).order('name')),
    read(supabase.from('product_links').select('*')),
    read(supabase.from('tire_events').select('*').eq('vehicle_id', vehicleId)),
    read(supabase.from('service_logs').select('id,date,service_type,performed_by,cost,odometer').eq('user_id', userId)),
  ])
  return {
    garage,
    types: (t.data ?? []) as ProductType[],
    buyLinks: (l.data ?? []) as ProductLink[],
    tireEvents: (e.data ?? []) as TireEvent[],
    logs: new Map(((logs.data ?? []) as LogRow[]).map(x => [x.id, x])),
  }
}

/** Everything the Stock page shows. Cached per car, reloads after any save. */
export function useStockData(userId: string | undefined, vehicleId: string | undefined, odo: number) {
  const [state, setState] = useState<{ vid: string; data: StockData } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  useDataRefresh(reload)

  useEffect(() => {
    if (!userId || !vehicleId) return
    let live = true
    fetchStock(userId, vehicleId, odo)
      .then(d => { if (!live) return; setCache(`stock:${vehicleId}`, d); setState({ vid: vehicleId, data: d }); setError(null) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Couldn’t load your stock.') })
    return () => { live = false }
  }, [userId, vehicleId, odo, tick])

  const fresh = state && state.vid === vehicleId ? state.data : null
  // Maps don't survive the cache's JSON, so only use it when it's a live object.
  const cached = !fresh && vehicleId ? getCache<StockData>(`stock:${vehicleId}`) : undefined
  const usable = cached && cached.garage?.stock instanceof Map ? cached : undefined
  return { data: fresh ?? usable ?? null, error, reload }
}
