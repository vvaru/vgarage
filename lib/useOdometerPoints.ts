'use client'

import { useEffect, useState } from 'react'
import { loadOdometerPoints, type OdoPoint } from '@/lib/odometer'

/**
 * A vehicle's fuel + service readings, for warning while a form is filled in.
 * Null until loaded. Reloads when `refreshKey` changes (e.g. each time a form opens).
 */
export function useOdometerPoints(vehicleId: string | undefined, refreshKey?: unknown): OdoPoint[] | null {
  const [points, setPoints] = useState<OdoPoint[] | null>(null)
  useEffect(() => {
    if (!vehicleId) return
    let live = true
    loadOdometerPoints(vehicleId).then(p => { if (live) setPoints(p) }).catch(() => { /* warnings just won't show */ })
    return () => { live = false }
  }, [vehicleId, refreshKey])
  return points
}
