'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDataRefresh } from '@/components/shell/forms'
import { fetchGarageRows, type GarageRows } from '@/lib/formData'

// The last rows per car, kept in memory (they hold Maps once built, which the JSON
// page cache can't), so going back to a page shows them at once while it re-checks.
const lastRows = new Map<string, GarageRows>()

/** The garage's rows for a page: shown from memory at once, re-fetched on mount and after any save. */
export function useGarage(userId: string | undefined, vehicleId: string | undefined) {
  const key = userId && vehicleId ? `${userId}:${vehicleId}` : null
  const [state, setState] = useState<{ key: string; rows: GarageRows } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  useDataRefresh(reload)

  useEffect(() => {
    if (!userId || !vehicleId) return
    let live = true
    const k = `${userId}:${vehicleId}`
    fetchGarageRows(userId, vehicleId)
      .then(rows => { if (!live) return; lastRows.set(k, rows); setState({ key: k, rows }); setError(null) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Couldn’t load your garage.') })
    return () => { live = false }
  }, [userId, vehicleId, tick])

  const rows = state && state.key === key ? state.rows : key ? lastRows.get(key) ?? null : null
  return { rows, error, reload }
}
