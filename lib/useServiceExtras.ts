'use client'

import { useMemo } from 'react'
import { useGarage } from '@/lib/useGarage'
import type { ProductU } from '@/lib/formData'
import type { ProductCategoryLink, Receipt, ReceiptItem, ServiceProductUsage } from '@/lib/types'
import type { Tire, TireEvent } from '@/lib/tires'

export interface ServiceExtras {
  products: Map<string, ProductU>
  usage: ServiceProductUsage[]
  receipts: Map<string, Receipt>
  items: Map<string, ReceiptItem>
  billLinks: { log_id: string; receipt_id: string }[]
  links: ProductCategoryLink[]
  tires: Tire[]
  tireEvents: TireEvent[]
}

const EMPTY: ServiceExtras = { products: new Map(), usage: [], receipts: new Map(), items: new Map(), billLinks: [], links: [], tires: [], tireEvents: [] }

/** Parts, receipts and tires behind each service, for the Services page detail. Quiet if anything is missing. */
export function useServiceExtras(userId: string | undefined, vehicleId: string | undefined): ServiceExtras {
  const { rows } = useGarage(userId, vehicleId)
  return useMemo(() => rows ? {
    products: new Map(rows.products.map(x => [x.id, x])),
    usage: rows.usage,
    receipts: new Map(rows.receipts.map(x => [x.id, x])),
    items: new Map(rows.items.map(x => [x.id, x])),
    billLinks: rows.billLinks,
    links: rows.links,
    tires: rows.tires,
    tireEvents: rows.tireEvents,
  } : EMPTY, [rows])
}
