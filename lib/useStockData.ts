'use client'

import { useMemo } from 'react'
import { buildGarage, type GarageContext, type LogRow } from '@/lib/formData'
import { useGarage } from '@/lib/useGarage'
import type { ProductType } from '@/lib/productTypes'
import type { TireEvent } from '@/lib/tires'
import type { ProductLink } from '@/lib/types'

export type { LogRow }

export interface StockData {
  garage: GarageContext
  types: ProductType[]
  buyLinks: ProductLink[]
  tireEvents: TireEvent[]
  logs: Map<string, LogRow>
}

/** Everything the Stock page shows, from the shared garage loader. */
export function useStockData(userId: string | undefined, vehicleId: string | undefined, odo: number) {
  const { rows, error, reload } = useGarage(userId, vehicleId)
  const data = useMemo<StockData | null>(() => rows && {
    garage: buildGarage(rows, odo),
    types: rows.types,
    buyLinks: rows.productLinks,
    tireEvents: rows.tireEvents,
    logs: new Map(rows.logs.map(l => [l.id, l])),
  }, [rows, odo])
  return { data, error, reload }
}
