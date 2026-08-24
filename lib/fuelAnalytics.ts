import { parseISO, format, differenceInCalendarDays, startOfMonth, endOfMonth } from 'date-fns'
import type { FuelLog } from '@/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// Cost analytics for the fuel log. Everything here derives from fields that
// already exist — gallons, price_per_gallon, total_cost, odometer, date, mpg.
//
// NOTE ON DRIVING MODE: there is no driving_mode column. Mode is DERIVED from
// how a fill-up's MPG compares to the best MPG of its own season occurrence —
// the same benchmark the per-entry "could've saved" figure already uses. That
// keeps one definition of "driving efficiently" across the page, and needs no
// back-fill onto historical fill-ups. Thresholds are here so they're easy to move.
// ─────────────────────────────────────────────────────────────────────────────

export type DrivingMode = 'efficient' | 'mixed' | 'aggressive'

export const MODE_THRESHOLDS = { efficient: 0.95, mixed: 0.85 }

export const MODE_LABELS: Record<DrivingMode, string> = {
  efficient: 'Efficient',
  mixed: 'Mixed',
  aggressive: 'Aggressive',
}

export function classifyMode(mpg: number, seasonBest: number): DrivingMode | null {
  if (!(mpg > 0) || !(seasonBest > 0)) return null
  const ratio = mpg / seasonBest
  if (ratio >= MODE_THRESHOLDS.efficient) return 'efficient'
  if (ratio >= MODE_THRESHOLDS.mixed) return 'mixed'
  return 'aggressive'
}

/** Which occurrence of a season a date falls in — Jan 2026 belongs to Winter-2025. */
export function seasonInstanceKey(dateStr: string): string {
  const d = parseISO(dateStr)
  const m = d.getMonth()
  const y = d.getFullYear()
  if (m === 11) return `Winter-${y}`
  if (m <= 1) return `Winter-${y - 1}`
  if (m <= 4) return `Spring-${y}`
  if (m <= 7) return `Summer-${y}`
  return `Fall-${y}`
}

export function seasonBests(logs: FuelLog[], excluded: Set<string>): Map<string, number> {
  const best = new Map<string, number>()
  for (const l of logs) {
    if (l.mpg == null || excluded.has(l.id)) continue
    const k = seasonInstanceKey(l.date)
    const v = Number(l.mpg)
    if (!(v > 0)) continue
    const cur = best.get(k)
    if (cur == null || v > cur) best.set(k, v)
  }
  return best
}

export interface FuelPoint {
  log: FuelLog
  date: string
  miles: number | null          // since the previous fill-up
  days: number | null           // elapsed over that same segment
  costPerMile: number | null
  pricePerGallon: number | null
  gallonsPer100: number | null
  mode: DrivingMode | null
  savings: number | null        // what matching the season's best MPG would have saved
}

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

/**
 * Enrich each fill-up with the derived per-entry figures. `excluded` carries the
 * missed-fill / outlier ids: those distort miles-since-last-fill just as badly as
 * they distort MPG, so their cost-per-mile is withheld rather than shown wrong.
 */
export function buildPoints(logs: FuelLog[], excluded: Set<string> = new Set()): FuelPoint[] {
  const asc = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.odometer - b.odometer)
  const bests = seasonBests(logs, excluded)

  return asc.map((log, i) => {
    const prev = asc[i - 1]
    const rawMiles = prev ? log.odometer - prev.odometer : null
    const usable = !excluded.has(log.id)
    const miles = rawMiles != null && rawMiles > 0 && usable ? rawMiles : null
    const rawDays = prev ? differenceInCalendarDays(parseISO(log.date), parseISO(prev.date)) : null
    const days = miles != null && rawDays != null && rawDays > 0 ? rawDays : null

    const total = num(log.total_cost)
    const mpg = num(log.mpg)
    const best = bests.get(seasonInstanceKey(log.date)) ?? null

    let savings: number | null = null
    if (usable && mpg != null && total != null && best != null && best > 0) {
      const s = total * (1 - mpg / best)
      savings = s > 0 ? s : 0
    }

    return {
      log,
      date: log.date,
      miles,
      days,
      costPerMile: miles != null && total != null && miles > 0 ? total / miles : null,
      pricePerGallon: num(log.price_per_gallon),
      gallonsPer100: usable && mpg != null && mpg > 0 ? 100 / mpg : null,
      mode: usable && mpg != null && best != null ? classifyMode(mpg, best) : null,
      savings,
    }
  })
}

// ── Monthly bucketing ────────────────────────────────────────────────────────

export interface MonthBucket {
  key: string        // yyyy-MM, for sorting
  label: string      // "Aug 26"
  value: number
  count: number
}

/** Group points into calendar months, summing or averaging the chosen figure. */
export function bucketByMonth(
  points: FuelPoint[],
  pick: (p: FuelPoint) => number | null,
  mode: 'sum' | 'avg' = 'avg',
): MonthBucket[] {
  const buckets = new Map<string, { total: number; count: number }>()
  for (const p of points) {
    const v = pick(p)
    if (v == null || isNaN(v)) continue
    const key = p.date.slice(0, 7)
    const b = buckets.get(key) ?? { total: 0, count: 0 }
    b.total += v
    b.count += 1
    buckets.set(key, b)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, b]) => ({
      key,
      label: format(parseISO(`${key}-01`), 'MMM yy'),
      value: mode === 'sum' ? b.total : b.total / b.count,
      count: b.count,
    }))
}

// ── Cost of driving mode ─────────────────────────────────────────────────────

export interface ModeCost {
  mode: DrivingMode
  costPer100: number | null   // avg gallons per 100 mi × avg $/gal
  avgMpg: number | null
  count: number
}

export function modeCosts(points: FuelPoint[]): ModeCost[] {
  const modes: DrivingMode[] = ['efficient', 'mixed', 'aggressive']
  return modes.map(mode => {
    const rows = points.filter(p => p.mode === mode)
    const g100 = rows.map(p => p.gallonsPer100).filter((v): v is number => v != null)
    const ppg = rows.map(p => p.pricePerGallon).filter((v): v is number => v != null && v > 0)
    const mpgs = rows.map(p => num(p.log.mpg)).filter((v): v is number => v != null && v > 0)
    const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
    const avgG100 = avg(g100)
    const avgPpg = avg(ppg)
    return {
      mode,
      costPer100: avgG100 != null && avgPpg != null ? avgG100 * avgPpg : null,
      avgMpg: avg(mpgs),
      count: rows.length,
    }
  })
}

/** How much more 100 miles costs driven aggressively than efficiently. */
export function aggressivePremium(costs: ModeCost[]): number | null {
  const eff = costs.find(c => c.mode === 'efficient')?.costPer100
  const agg = costs.find(c => c.mode === 'aggressive')?.costPer100
  if (eff == null || agg == null) return null
  const diff = agg - eff
  return diff > 0 ? diff : null
}

// ── Budget forecast ──────────────────────────────────────────────────────────

export interface Forecast {
  projected: number       // total spend expected for the calendar month
  spentSoFar: number
  costPerMile: number
  dailyMiles: number
  daysLeft: number
  fillupsThisMonth: number
}

/**
 * Miles per day, summed segment-wise. Measuring across the outer date span
 * instead would count a segment's miles against a window that doesn't contain
 * them — the first segment's mileage accrued BEFORE its own fill-up date — which
 * inflates the rate and, through it, every forecast.
 */
export function avgDailyMiles(points: FuelPoint[]): number | null {
  const usable = points.filter(p => p.miles != null && p.days != null && p.days > 0)
  if (usable.length === 0) return null
  const miles = usable.reduce((s, p) => s + (p.miles ?? 0), 0)
  const days = usable.reduce((s, p) => s + (p.days ?? 0), 0)
  return days > 0 ? miles / days : null
}

/** Rolling $/mile over the most recent fill-ups that have a usable figure. */
export function rollingCostPerMile(points: FuelPoint[], window = 5): number | null {
  const usable = points.filter(p => p.costPerMile != null && p.costPerMile > 0).slice(-window)
  if (usable.length === 0) return null
  return usable.reduce((s, p) => s + (p.costPerMile ?? 0), 0) / usable.length
}

/**
 * Projected spend for the current calendar month. Deliberately withheld until
 * there are at least `minFillups` this month — one fill-up says nothing about a
 * month's driving, and a confident wrong number is worse than no number.
 */
export function forecastMonth(points: FuelPoint[], now = new Date(), minFillups = 2): Forecast | null {
  const monthKey = format(now, 'yyyy-MM')
  const thisMonth = points.filter(p => p.date.slice(0, 7) === monthKey)
  if (thisMonth.length < minFillups) return null

  const cpm = rollingCostPerMile(points)
  const daily = avgDailyMiles(points)
  if (cpm == null || daily == null) return null

  const spentSoFar = thisMonth.reduce((s, p) => s + (num(p.log.total_cost) ?? 0), 0)
  const daysLeft = Math.max(0, differenceInCalendarDays(endOfMonth(now), now))

  return {
    projected: spentSoFar + daily * daysLeft * cpm,
    spentSoFar,
    costPerMile: cpm,
    dailyMiles: daily,
    daysLeft,
    fillupsThisMonth: thisMonth.length,
  }
}

/** Total missed savings across the given points. */
export const totalSavings = (points: FuelPoint[]): number =>
  points.reduce((s, p) => s + (p.savings ?? 0), 0)

/** Is the monthly gap shrinking? Compares the last bucket to the one before. */
export function savingsTrend(buckets: MonthBucket[]): 'improving' | 'worsening' | null {
  if (buckets.length < 2) return null
  const last = buckets[buckets.length - 1].value
  const prev = buckets[buckets.length - 2].value
  if (Math.abs(last - prev) < 0.01) return null
  return last < prev ? 'improving' : 'worsening'
}

export { startOfMonth }
