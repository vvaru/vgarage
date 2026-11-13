import { format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────────
// Odometer readings only go up, so a reading has to fit between the entries
// around its date — fuel and service entries alike:
//   · at least the highest reading on the nearest EARLIER date
//   · at most the highest reading on the nearest LATER date (none → no limit)
// Using each neighbouring day's highest reading widens the range when that day
// has several entries. Entries on the SAME date never constrain each other —
// the order within a day isn't recorded — so a reading on the latest entry's
// date is checked against the day before it.
// ─────────────────────────────────────────────────────────────────────────────

export interface OdoPoint {
  id: string
  kind: 'fuel' | 'service'
  date: string        // yyyy-MM-dd
  odometer: number
}

export interface OdoBounds { low: OdoPoint | null; high: OdoPoint | null }

/** Highest reading on the given day. */
const highestOn = (points: OdoPoint[], day: string): OdoPoint =>
  points.filter(p => p.date === day).reduce((a, b) => (b.odometer > a.odometer ? b : a))

export function odometerBounds(points: OdoPoint[], date: string, ignoreIds: string[] = []): OdoBounds {
  // 0 = "unknown" (e.g. imported records without a reading); it bounds nothing.
  const pts = points.filter(p => p.odometer > 0 && !ignoreIds.includes(p.id))
  const earlier = pts.filter(p => p.date < date).map(p => p.date).sort()
  const later = pts.filter(p => p.date > date).map(p => p.date).sort()
  return {
    low: earlier.length ? highestOn(pts, earlier[earlier.length - 1]) : null,
    high: later.length ? highestOn(pts, later[0]) : null,
  }
}

const describe = (p: OdoPoint): string =>
  `your ${p.kind} entry on ${format(parseISO(p.date), 'MMM d, yyyy')} shows ${p.odometer.toLocaleString()} mi`

/** Why this reading can't be right for this date, or null if it fits. */
export function odometerProblem(points: OdoPoint[], date: string, odometer: number, ignoreIds: string[] = []): string | null {
  if (!date || !(odometer > 0)) return null
  const { low, high } = odometerBounds(points, date, ignoreIds)
  if (low && odometer < low.odometer) {
    return `Odometer can’t be below ${low.odometer.toLocaleString()} mi on this date — ${describe(low)}. Check this reading, or that entry.`
  }
  if (high && odometer > high.odometer) {
    return `Odometer can’t be above ${high.odometer.toLocaleString()} mi on this date — ${describe(high)}. Check this reading, or that entry.`
  }
  return null
}

/** Every fuel and service reading for a vehicle. */
export async function loadOdometerPoints(vehicleId: string): Promise<OdoPoint[]> {
  const [fuel, service] = await Promise.all([
    supabase.from('fuel_logs').select('id, date, odometer').eq('vehicle_id', vehicleId),
    supabase.from('service_logs').select('id, date, odometer').eq('vehicle_id', vehicleId),
  ])
  if (fuel.error) throw new Error(fuel.error.message)
  if (service.error) throw new Error(service.error.message)
  const rows = (kind: OdoPoint['kind'], data: { id: string; date: string; odometer: number | null }[] | null): OdoPoint[] =>
    (data ?? []).map(r => ({ id: r.id, kind, date: String(r.date).slice(0, 10), odometer: Number(r.odometer ?? 0) }))
  return [...rows('fuel', fuel.data), ...rows('service', service.data)]
}

/**
 * Check a reading against fresh data, right before saving. Returns the problem,
 * or null. If the check itself can't run (offline), it doesn't block the save.
 */
export async function checkOdometer(vehicleId: string, date: string, odometer: number, ignoreIds: string[] = []): Promise<string | null> {
  try {
    return odometerProblem(await loadOdometerPoints(vehicleId), date, odometer, ignoreIds)
  } catch {
    return null
  }
}
