'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { read } from '@/lib/recover'
import { useDataRefresh } from '@/components/shell/forms'
import type { Product, ProductCategoryLink, Receipt, ReceiptItem, ServiceProductUsage } from '@/lib/types'
import type { Tire, TireEvent } from '@/lib/tires'

export interface ServiceExtras {
  products: Map<string, Product & { unit?: string }>
  usage: ServiceProductUsage[]
  receipts: Map<string, Receipt>
  items: Map<string, ReceiptItem>
  billLinks: { log_id: string; receipt_id: string }[]
  links: ProductCategoryLink[]
  tires: Tire[]
  tireEvents: TireEvent[]
}

const EMPTY: ServiceExtras = { products: new Map(), usage: [], receipts: new Map(), items: new Map(), billLinks: [], links: [], tires: [], tireEvents: [] }

async function fetchExtras(userId: string, vehicleId: string): Promise<ServiceExtras> {
  const [p, u, r, i, b, t, e, pl] = await Promise.all([
    read(supabase.from('products').select('*').eq('user_id', userId)),
    read(supabase.from('service_product_usage').select('*')),
    read(supabase.from('receipts').select('*').eq('user_id', userId)),
    read(supabase.from('receipt_items').select('*')),
    read(supabase.from('service_log_receipts').select('*')),
    read(supabase.from('tires').select('*')),
    read(supabase.from('tire_events').select('*').eq('vehicle_id', vehicleId)),
    read(supabase.from('product_category_links').select('*')),
  ])
  return {
    products: new Map(((p.data ?? []) as (Product & { unit?: string })[]).map(x => [x.id, x])),
    usage: (u.data ?? []) as ServiceProductUsage[],
    receipts: new Map(((r.data ?? []) as Receipt[]).map(x => [x.id, x])),
    items: new Map(((i.data ?? []) as ReceiptItem[]).map(x => [x.id, x])),
    billLinks: (b.data ?? []) as { log_id: string; receipt_id: string }[],
    tires: (t.data ?? []) as Tire[],
    tireEvents: (e.data ?? []) as TireEvent[],
    links: (pl.data ?? []) as ProductCategoryLink[],
  }
}

/** Parts, receipts and tires behind each service, for the Services page detail. Quiet if anything is missing. */
export function useServiceExtras(userId: string | undefined, vehicleId: string | undefined): ServiceExtras {
  const [state, setState] = useState<{ key: string; data: ServiceExtras } | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  useDataRefresh(reload)
  useEffect(() => {
    if (!userId || !vehicleId) return
    let live = true
    fetchExtras(userId, vehicleId).then(d => { if (live) setState({ key: vehicleId, data: d }) }).catch(() => {})
    return () => { live = false }
  }, [userId, vehicleId, tick])
  return state && state.key === vehicleId ? state.data : EMPTY
}
