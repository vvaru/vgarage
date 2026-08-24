'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { format, parseISO, subDays, subMonths, subYears, getMonth } from 'date-fns'
import { Plus, Trash2, Pencil, Fuel, TrendingUp, Leaf, ChevronDown, ChevronRight, Gauge, CalendarClock } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, ReferenceLine,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { withRetry, withTimeout } from '@/lib/recover'
import { getCache, setCache } from '@/lib/cache'
import { recomputeFuelMpg } from '@/lib/fuelMpg'
import FuelLogModal from '@/components/fuel/FuelLogModal'
import {
  buildPoints, bucketByMonth, modeCosts, aggressivePremium, forecastMonth,
  rollingCostPerMile, totalSavings, savingsTrend, modeBands, MODE_LABELS,
} from '@/lib/fuelAnalytics'
import type { FuelLog } from '@/lib/types'

type Period = 'week' | 'month' | '3mo' | 'year' | 'all'
type TrendMetric = 'mpg' | 'cpm'

type ChartView = 'combined' | 'mode'

const TREND_METRICS: { key: TrendMetric; label: string }[] = [
  { key: 'mpg', label: 'MPG' },
  { key: 'cpm', label: 'Cost / mile' },
]

const MODE_COLORS: Record<string, string> = {
  efficient: '#22c55e',
  aggressive: '#f97316',
  mixed: '#52525b',
}

// Mixed fill-ups are drawn small and dim: they're the middle of the distribution
// and say little, so they stay visible as context without pulling the eye.
const ModeDot = (props: { cx?: number; cy?: number; payload?: { mode?: string | null } }) => {
  const { cx, cy, payload } = props
  if (cx == null || cy == null) return null
  const mode = payload?.mode ?? null
  const loud = mode === 'efficient' || mode === 'aggressive'
  return (
    <circle
      cx={cx} cy={cy}
      r={loud ? 5 : 3.5}
      fill={MODE_COLORS[mode ?? 'mixed'] ?? MODE_COLORS.mixed}
      opacity={loud ? 1 : 0.5}
    />
  )
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: '3mo', label: '3 Mo' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All' },
]

const SEASONS = [
  { label: 'Winter', months: [11, 0, 1] },   // Dec Jan Feb
  { label: 'Spring', months: [2, 3, 4] },     // Mar Apr May
  { label: 'Summer', months: [5, 6, 7] },     // Jun Jul Aug
  { label: 'Fall',   months: [8, 9, 10] },    // Sep Oct Nov
]

// Shared across every chart on the page; `fmt` decides how the value reads.
const makeTooltip = (fmt: (v: number) => string) => {
  const Inner = ({ active, payload, label }: {
    active?: boolean
    payload?: Array<{ value: number }>
    label?: string
  }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-surface border border-border-strong rounded-xl px-3 py-2 shadow-xl">
        <p className="text-muted text-xs mb-1">{label}</p>
        <p className="text-foreground text-sm font-bold">{fmt(payload[0].value)}</p>
      </div>
    )
  }
  Inner.displayName = 'ChartTooltip'
  return Inner
}

const MpgTooltip = makeTooltip(v => `${v.toFixed(1)} mpg`)
const CpmTooltip = makeTooltip(v => `$${v.toFixed(3)} / mile`)
const PpgTooltip = makeTooltip(v => `$${v.toFixed(2)} / gal`)
const MoneyTooltip = makeTooltip(v => `$${v.toFixed(2)}`)

function getCutoff(period: Period): Date | null {
  const now = new Date()
  if (period === 'week')  return subDays(now, 7)
  if (period === 'month') return subMonths(now, 1)
  if (period === '3mo')   return subMonths(now, 3)
  if (period === 'year')  return subYears(now, 1)
  return null
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Which OCCURRENCE of a season a date belongs to — e.g. a Jan 2026 fill-up belongs to
// the winter that began Dec 2025 ("Winter-2025"). This lets each fill-up be judged
// against the best MPG of its own ongoing season, not all past winters/summers.
function seasonInstanceKey(dateStr: string): string {
  const d = parseISO(dateStr)
  const m = d.getMonth()
  const y = d.getFullYear()
  if (m === 11) return `Winter-${y}`       // Dec starts this winter
  if (m <= 1) return `Winter-${y - 1}`     // Jan / Feb belong to the winter that started last Dec
  if (m <= 4) return `Spring-${y}`
  if (m <= 7) return `Summer-${y}`
  return `Fall-${y}`                        // Sep / Oct / Nov
}

// Flags fills whose MPG is an implausible high outlier vs THIS vehicle's own
// history — the signature of a forgotten earlier fill-up (≈2× the norm). Fully
// self-calibrating from the data (median + MAD), so it adapts to any MPG or tank
// size, and it skips the high half of a partial-fill pair (a top-off shows up as
// an abnormally low reading immediately before a high one).
function detectMissedFills(logs: FuelLog[]): Set<string> {
  const flags = new Set<string>()
  const withMpg = logs
    .filter(l => l.mpg != null && Number(l.mpg) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (withMpg.length < 4) return flags
  const vals = withMpg.map(l => Number(l.mpg))
  const med = median(vals)
  const mad = median(vals.map(v => Math.abs(v - med))) || med * 0.15
  const threshold = Math.max(med * 1.8, med + 3 * mad)
  for (let i = 0; i < withMpg.length; i++) {
    if (vals[i] <= threshold) continue
    if (i > 0 && vals[i - 1] < med * 0.7 && (vals[i] + vals[i - 1]) / 2 < med * 1.3) continue
    flags.add(withMpg[i].id)
  }
  return flags
}

export default function FuelPage() {
  const { vehicle } = useVehicle()
  const [logs, setLogs] = useState<FuelLog[]>([])
  const [loading, setLoading] = useState(true)
  const [fuelModal, setFuelModal] = useState<{ log: FuelLog | null } | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  // Three months is enough fill-ups for a trend to have a shape, without
  // reaching so far back that recent driving gets averaged away.
  const [period, setPeriod] = useState<Period>('3mo')
  const [trendMetric, setTrendMetric] = useState<TrendMetric>('mpg')
  const [chartView, setChartView] = useState<ChartView>('combined')
  const [showPrice, setShowPrice] = useState(false)
  // Manual overrides for MPG counting, persisted per-device.
  const [manualInclude, setManualInclude] = useState<Set<string>>(new Set()) // force-count
  const [manualExclude, setManualExclude] = useState<Set<string>>(new Set()) // force-exclude

  useEffect(() => {
    try {
      const inc = localStorage.getItem('vgarage_mpg_keep')
      const exc = localStorage.getItem('vgarage_mpg_exclude')
      if (inc) setManualInclude(new Set(JSON.parse(inc) as string[]))
      if (exc) setManualExclude(new Set(JSON.parse(exc) as string[]))
    } catch { /* ignore */ }
  }, [])

  function persist(key: string, set: Set<string>) {
    try { localStorage.setItem(key, JSON.stringify([...set])) } catch { /* ignore */ }
  }
  function markReal(id: string) {
    setManualInclude(prev => { const n = new Set(prev); n.add(id); persist('vgarage_mpg_keep', n); return n })
    setManualExclude(prev => { const n = new Set(prev); n.delete(id); persist('vgarage_mpg_exclude', n); return n })
  }
  function markMissed(id: string) {
    setManualExclude(prev => { const n = new Set(prev); n.add(id); persist('vgarage_mpg_exclude', n); return n })
    setManualInclude(prev => { const n = new Set(prev); n.delete(id); persist('vgarage_mpg_keep', n); return n })
  }

  const cacheFirstFor = useRef<string | null>(null)
  const load = useCallback(async () => {
    if (!vehicle) return
    const key = `fuel:${vehicle.id}`
    const fetchFresh = async () => {
      const { data } = await withRetry(() => withTimeout(supabase
        .from('fuel_logs')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .order('date', { ascending: false }), 8000))
      const logs = data ?? []
      setLogs(logs)
      setCache(key, logs)
    }
    // First view of this vehicle's page (fresh mount / navigation / vehicle switch):
    // if we already have the data cached, show it instantly and quietly re-check in
    // the background. Later calls for the same vehicle (after a write) fetch fresh.
    if (cacheFirstFor.current !== vehicle.id) {
      cacheFirstFor.current = vehicle.id
      const cached = getCache<FuelLog[]>(key)
      if (cached) {
        setLogs(cached)
        setLoading(false)
        fetchFresh().catch(() => { /* background re-check; keep showing cached */ })
        return
      }
    }
    // No cache yet, or an explicit reload after a write: fetch and show a spinner.
    setLoading(true)
    try {
      await fetchFresh()
    } catch { /* both attempts failed — leave existing data, finally clears spinner */ } finally {
      setLoading(false)
    }
  }, [vehicle])

  useEffect(() => { load() }, [load])

  async function handleDelete(id: string) {
    if (!vehicle) return
    await supabase.from('fuel_logs').delete().eq('id', id)
    setDeleteId(null)
    // Removing a fill-up changes the "previous" for the one after it — recompute.
    await recomputeFuelMpg(vehicle.id)
    await load()
  }

  // Period-filtered logs
  const cutoff = getCutoff(period)
  const filteredLogs = cutoff
    ? logs.filter(l => parseISO(l.date) >= cutoff)
    : logs

  // A reading is excluded from MPG if the user force-excluded it, OR it was
  // auto-flagged as a likely missed fill and the user hasn't marked it real.
  const missedFlags = detectMissedFills(logs)
  const outlierIds = new Set(
    logs
      .filter(l => l.mpg != null && (manualExclude.has(l.id) || (missedFlags.has(l.id) && !manualInclude.has(l.id))))
      .map(l => l.id)
  )

  const withMpg = filteredLogs.filter(l => l.mpg != null && !outlierIds.has(l.id))
  const avgMpg = withMpg.length
    ? withMpg.reduce((s, l) => s + Number(l.mpg), 0) / withMpg.length
    : null

  const totalSpend = filteredLogs.reduce((s, l) => s + Number(l.total_cost), 0)
  const totalGallons = filteredLogs.reduce((s, l) => s + Number(l.gallons), 0)

  const chartData = [...filteredLogs]
    .filter(l => l.mpg != null && !outlierIds.has(l.id))
    .reverse()
    .map(l => ({
      date: format(parseISO(l.date), 'MMM d'),
      mpg: Number(l.mpg),
    }))

  // Seasonal averages (always use all logs)
  const seasonalAvgs = SEASONS.map(season => {
    const seasonLogs = logs.filter(l => {
      const m = getMonth(parseISO(l.date))
      return season.months.includes(m) && l.mpg != null && !outlierIds.has(l.id)
    })
    const avg = seasonLogs.length
      ? seasonLogs.reduce((s, l) => s + Number(l.mpg), 0) / seasonLogs.length
      : null
    return { label: season.label, avg, count: seasonLogs.length }
  })

  const hasSeasonalData = seasonalAvgs.some(s => s.avg != null)

  // ── "If I'd driven conservatively" savings ─────────────────────────────────
  // Target for each fill-up = the best MPG achieved in that fill-up's own season
  // OCCURRENCE (this winter, this summer — not across years), ignoring outliers.
  // Savings = what you paid × (1 − yourMPG / bestMPG): the fuel dollars you'd have
  // saved covering the same miles at that better MPG. Benchmark spans all history
  // (so it's stable); the total below is limited to the selected period.
  const seasonBest = new Map<string, number>()
  for (const l of logs) {
    if (l.mpg == null || outlierIds.has(l.id)) continue
    const k = seasonInstanceKey(l.date)
    const v = Number(l.mpg)
    const cur = seasonBest.get(k)
    if (cur == null || v > cur) seasonBest.set(k, v)
  }
  const savingsFor = (l: FuelLog): number | null => {
    if (l.mpg == null || outlierIds.has(l.id) || l.total_cost == null) return null
    const best = seasonBest.get(seasonInstanceKey(l.date))
    if (best == null || best <= 0) return null
    const s = Number(l.total_cost) * (1 - Number(l.mpg) / best)
    return s > 0 ? s : 0
  }
  const conservativeSavings = filteredLogs.reduce((sum, l) => sum + (savingsFor(l) ?? 0), 0)

  // ── Cost analytics ─────────────────────────────────────────────────────────
  // Points are built from ALL logs so miles-since-last-fill can look back past
  // the period boundary, then filtered — otherwise the first fill-up in every
  // range would have no previous odometer to measure against.
  const allPoints = buildPoints(logs, outlierIds)
  const points = cutoff ? allPoints.filter(p => parseISO(p.date) >= cutoff) : allPoints

  const currentCpm = rollingCostPerMile(points)
  const costs = modeCosts(points)
  const premium = aggressivePremium(costs)
  const forecast = forecastMonth(allPoints)
  const savingsByMonth = bucketByMonth(points, p => p.savings, 'sum')
  const savingsDirection = savingsTrend(savingsByMonth)
  const rangeSavings = totalSavings(points)

  // "All" groups by month only once there are enough fill-ups that plotting each
  // one would be unreadable. Below that, bucketing throws away detail for
  // nothing — a three-month history collapses to three points and says less
  // than the raw series it replaced.
  const BUCKET_ABOVE = 40
  const byMonth = period === 'all' && points.length > BUCKET_ABOVE
  const mpgSeries = byMonth
    ? bucketByMonth(points, p => (p.log.mpg != null ? Number(p.log.mpg) : null), 'avg')
        .map(b => ({ date: b.label, value: b.value }))
    : chartData.map(d => ({ date: d.date, value: d.mpg }))
  const cpmSeries = byMonth
    ? bucketByMonth(points, p => p.costPerMile, 'avg').map(b => ({ date: b.label, value: b.value }))
    : points.filter(p => p.costPerMile != null)
        .map(p => ({ date: format(parseISO(p.date), 'MMM d'), value: p.costPerMile as number }))
  const ppgSeries = byMonth
    ? bucketByMonth(points, p => p.pricePerGallon, 'avg').map(b => ({ date: b.label, value: b.value }))
    : points.filter(p => p.pricePerGallon != null)
        .map(p => ({ date: format(parseISO(p.date), 'MMM d'), value: p.pricePerGallon as number }))

  // Split-by-mode is a per-fill-up property, so it never buckets — averaging a
  // month of mixed modes into one point would erase the very thing being shown.
  const modeSeries = points
    .filter(p => p.log.mpg != null && p.mode != null)
    .map(p => ({ date: format(parseISO(p.date), 'MMM d'), value: Number(p.log.mpg), mode: p.mode }))
  const splitByMode = trendMetric === 'mpg' && chartView === 'mode'
  const trendSeries = splitByMode ? modeSeries : trendMetric === 'mpg' ? mpgSeries : cpmSeries

  const bands = modeBands(logs, outlierIds)
  const modeAvg = (m: string) => costs.find(c => c.mode === m)?.avgMpg ?? null
  const efficientAvg = modeAvg('efficient')
  const aggressiveAvg = modeAvg('aggressive')
  const modeGap = efficientAvg != null && aggressiveAvg != null ? efficientAvg - aggressiveAvg : null
  const canSplit = modeSeries.length >= 2

  const stats = [
    { label: 'Avg MPG', value: avgMpg ? avgMpg.toFixed(1) : '—', accent: true },
    { label: 'Cost / mile', value: currentCpm != null ? `$${currentCpm.toFixed(3)}` : '—', accent: true },
    { label: 'Total Spent', value: `$${totalSpend.toFixed(0)}` },
    { label: 'Gallons', value: totalGallons.toFixed(0) },
    { label: 'Fillups', value: String(filteredLogs.length) },
  ]

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto px-4 lg:px-8 pt-10 lg:pt-8 pb-28 lg:pb-12">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="text-muted text-xs font-medium uppercase tracking-widest">Fuel</p>
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground mt-0.5">Fuel Log</h1>
          </div>
          <button
            onClick={() => setFuelModal({ log: null })}
            className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-accent-foreground font-bold rounded-2xl px-4 lg:px-5 py-2.5 text-sm transition-colors shadow-sm shadow-accent/20"
          >
            <Plus size={16} /> Add Fillup
          </button>
        </div>

        {!loading && logs.length === 0 ? (
          <div className="text-center py-24">
            <Fuel size={44} className="text-faint mx-auto mb-3" />
            <p className="text-muted font-medium">No fuel records yet</p>
            <p className="text-faint text-sm mt-1">Add a fillup after every visit to track MPG</p>
            <button onClick={() => setFuelModal({ log: null })} className="mt-5 inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-accent-foreground font-bold rounded-2xl px-5 py-2.5 text-sm transition-colors">
              <Plus size={16} /> Add your first fillup
            </button>
          </div>
        ) : (
          <>
            {/* Period filter */}
            {logs.length > 0 && (
              <div className="flex gap-2 mb-5 flex-wrap">
                {PERIODS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      period === p.key
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-surface-2 text-muted hover:text-foreground'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
              {stats.map(s => (
                <div key={s.label} className="bg-surface border border-border rounded-2xl p-4">
                  <p className={`text-2xl lg:text-3xl font-bold tracking-tight ${s.accent ? 'text-accent' : 'text-foreground'}`}>{s.value}</p>
                  <p className="text-xs text-muted mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Cumulative savings + whether the monthly gap is closing */}
            {conservativeSavings >= 0.005 && (
              <div className="bg-surface border border-border rounded-2xl p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                  <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
                    <Leaf size={20} className="text-success" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl lg:text-3xl font-bold tracking-tight text-success">${conservativeSavings.toFixed(2)}</p>
                    <p className="text-xs text-muted mt-0.5">
                      Left on the table by not matching your best MPG each season
                      {period !== 'all' ? ` · ${PERIODS.find(p => p.key === period)?.label}` : ' · all time'}
                    </p>
                    {savingsDirection && (
                      <p className={`text-xs mt-1 font-medium ${savingsDirection === 'improving' ? 'text-success' : 'text-warn'}`}>
                        {savingsDirection === 'improving' ? '↓ Gap shrinking vs last month' : '↑ Gap growing vs last month'}
                      </p>
                    )}
                  </div>
                </div>
                {savingsByMonth.length >= 2 && (
                  <div className="w-full sm:w-52 h-16 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={savingsByMonth} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                        <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <Tooltip content={<MoneyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                        <Bar dataKey="value" fill="#22c55e" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}

            {/* Projected spend + what aggressive driving costs */}
            {(forecast || premium != null) && (
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                {forecast && (
                  <div className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                      <CalendarClock size={20} className="text-accent" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold tracking-tight text-accent">~${forecast.projected.toFixed(0)}</p>
                      <p className="text-xs text-muted mt-0.5">Projected fuel spend this month</p>
                      <p className="text-faint text-[11px] mt-0.5">
                        ${forecast.spentSoFar.toFixed(0)} so far · {forecast.dailyMiles.toFixed(0)} mi/day × {forecast.daysLeft} days left
                      </p>
                    </div>
                  </div>
                )}
                {premium != null && (
                  <div className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-4">
                    <div className="w-11 h-11 rounded-xl bg-warn/10 flex items-center justify-center shrink-0">
                      <Gauge size={20} className="text-warn" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold tracking-tight text-warn">+${premium.toFixed(2)}</p>
                      <p className="text-xs text-muted mt-0.5">Aggressive costs more per 100 miles than efficient</p>
                      <p className="text-faint text-[11px] mt-0.5">
                        {costs.filter(c => c.costPer100 != null).map(c =>
                          `${MODE_LABELS[c.mode]} $${c.costPer100!.toFixed(2)}`).join(' · ')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* MPG Trend + Seasonal: side by side on laptop */}
            <div className="grid lg:grid-cols-3 gap-4 mb-4">
              {trendSeries.length >= 2 && (
                <div className={`bg-surface border border-border rounded-2xl p-4 ${hasSeasonalData ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
                  <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={16} className="text-accent" />
                      <p className="text-sm font-semibold text-foreground">
                        {trendMetric === 'mpg' ? 'MPG Trend' : 'Cost per Mile'}
                        {byMonth && !splitByMode && <span className="text-faint font-normal"> · monthly</span>}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {TREND_METRICS.map(m => (
                        <button
                          key={m.key}
                          onClick={() => setTrendMetric(m.key)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                            trendMetric === m.key
                              ? 'bg-accent/15 text-accent border-accent/30'
                              : 'bg-surface-2 text-muted border-border-strong hover:text-foreground'
                          }`}
                        >{m.label}</button>
                      ))}
                      {trendMetric === 'mpg' && canSplit && (
                        <button
                          onClick={() => setChartView(v => (v === 'mode' ? 'combined' : 'mode'))}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                            splitByMode
                              ? 'bg-accent/15 text-accent border-accent/30'
                              : 'bg-surface-2 text-muted border-border-strong hover:text-foreground'
                          }`}
                        >Split by mode</button>
                      )}
                    </div>
                  </div>

                  {/* Legend carries the averages, so the dashed lines are readable */}
                  {splitByMode && (
                    <div className="flex items-center gap-4 flex-wrap mb-3 -mt-1">
                      {efficientAvg != null && (
                        <span className="flex items-center gap-1.5 text-xs text-muted">
                          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: MODE_COLORS.efficient }} />
                          Efficient <span className="text-foreground font-semibold">avg {efficientAvg.toFixed(1)}</span>
                        </span>
                      )}
                      {aggressiveAvg != null && (
                        <span className="flex items-center gap-1.5 text-xs text-muted">
                          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: MODE_COLORS.aggressive }} />
                          Aggressive <span className="text-foreground font-semibold">avg {aggressiveAvg.toFixed(1)}</span>
                        </span>
                      )}
                      <span className="flex items-center gap-1.5 text-xs text-faint">
                        <span className="w-2.5 h-2.5 rounded-sm opacity-50" style={{ background: MODE_COLORS.mixed }} />
                        Mixed
                      </span>
                      {bands && (
                        <span className="text-faint text-[11px] w-full sm:w-auto">
                          Your typical is {bands.center.toFixed(1)} — efficient at {bands.efficientAt.toFixed(1)}+,
                          aggressive at {bands.aggressiveAt.toFixed(1)} or below
                        </span>
                      )}
                    </div>
                  )}
                  <div className="h-[200px] lg:h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendSeries} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis
                          tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']}
                          tickFormatter={v => trendMetric === 'cpm' ? `$${Number(v).toFixed(2)}` : String(Math.round(Number(v)))}
                        />
                        <Tooltip content={trendMetric === 'mpg' ? <MpgTooltip /> : <CpmTooltip />} />
                        {splitByMode && efficientAvg != null && (
                          <ReferenceLine y={efficientAvg} stroke={MODE_COLORS.efficient} strokeDasharray="5 4" strokeWidth={1.5} />
                        )}
                        {splitByMode && aggressiveAvg != null && (
                          <ReferenceLine y={aggressiveAvg} stroke={MODE_COLORS.aggressive} strokeDasharray="5 4" strokeWidth={1.5} />
                        )}
                        {splitByMode ? (
                          <Line
                            type="linear" dataKey="value"
                            stroke="#3f3f46" strokeWidth={1} strokeDasharray="2 3"
                            dot={<ModeDot />} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false}
                          />
                        ) : (
                          <Line
                            type="monotone" dataKey="value"
                            stroke={trendMetric === 'mpg' ? '#f59e0b' : '#3b82f6'} strokeWidth={2.5}
                            dot={{ fill: trendMetric === 'mpg' ? '#f59e0b' : '#3b82f6', r: 3, strokeWidth: 0 }}
                            activeDot={{ r: 5, fill: trendMetric === 'mpg' ? '#f59e0b' : '#3b82f6', strokeWidth: 0 }}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* The comparison the split view exists to make */}
                  {splitByMode && modeGap != null && (
                    <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
                      <div className="flex-1 min-w-0">
                        <p className="text-xl font-bold" style={{ color: MODE_COLORS.efficient }}>{efficientAvg!.toFixed(1)}</p>
                        <p className="text-xs text-muted">Efficient-mode avg MPG</p>
                      </div>
                      <div
                        className="shrink-0 text-center px-2"
                        title={`Driving aggressively costs you ${modeGap.toFixed(1)} mpg versus your efficient tanks`}
                      >
                        <p className="text-sm font-bold text-warn whitespace-nowrap">↓ {modeGap.toFixed(1)} mpg</p>
                        <p className="text-faint text-[11px] leading-tight mt-0.5">lost driving<br />aggressively</p>
                      </div>
                      <div className="flex-1 min-w-0 text-right">
                        <p className="text-xl font-bold" style={{ color: MODE_COLORS.aggressive }}>{aggressiveAvg!.toFixed(1)}</p>
                        <p className="text-xs text-muted">Aggressive-mode avg MPG</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {hasSeasonalData && (
                <div className={`bg-surface border border-border rounded-2xl p-4 ${chartData.length >= 2 ? '' : 'lg:col-span-3'}`}>
                  <p className="text-sm font-semibold text-foreground mb-3">Seasonal MPG</p>
                  <div className="grid grid-cols-4 lg:grid-cols-2 gap-3">
                    {seasonalAvgs.map(s => (
                      <div key={s.label} className="text-center lg:text-left bg-surface-2/40 rounded-xl py-3 lg:px-3">
                        <p className={`text-lg font-bold ${s.avg != null ? 'text-accent' : 'text-faint'}`}>
                          {s.avg != null ? s.avg.toFixed(1) : '—'}
                        </p>
                        <p className="text-xs text-muted mt-0.5">{s.label}</p>
                        {s.count > 0 && <p className="text-faint text-xs">{s.count} fill{s.count === 1 ? '' : 's'}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* What he's paying per gallon — secondary, folded away by default so
                it doesn't compete with the MPG trend for attention.
                TODO: flag fill-ups >10% above the regional average via the EIA
                Open Data API (series PET.EMM_EPM0_PTE_SPA_DPG.W for PA). Left
                out of this pass — it needs an API key and a cached weekly fetch. */}
            {ppgSeries.length >= 2 && (
              <div className="bg-surface border border-border rounded-2xl mb-4">
                <button
                  onClick={() => setShowPrice(v => !v)}
                  className="w-full flex items-center justify-between gap-2 p-4 text-left"
                >
                  <div className="flex items-center gap-2">
                    {showPrice ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
                    <p className="text-sm font-semibold text-foreground">
                      Price per gallon{byMonth && <span className="text-faint font-normal"> · monthly</span>}
                    </p>
                  </div>
                  <span className="text-faint text-xs">
                    {ppgSeries.length > 0 && `latest $${ppgSeries[ppgSeries.length - 1].value.toFixed(2)}`}
                  </span>
                </button>
                {showPrice && (
                  <div className="h-[180px] px-4 pb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={ppgSeries} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} tickFormatter={v => `$${Number(v).toFixed(2)}`} />
                        <Tooltip content={<PpgTooltip />} />
                        <Line type="monotone" dataKey="value" stroke="#a1a1aa" strokeWidth={2} dot={{ fill: '#a1a1aa', r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4.5, fill: '#a1a1aa', strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}

            {/* History */}
            <h2 className="text-lg font-bold text-foreground mt-6 mb-3">History</h2>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-muted text-sm">No fillups in this period</p>
              </div>
            ) : (
              <div className="grid lg:grid-cols-2 gap-3">
                {filteredLogs.map((log, i) => {
                  const saved = savingsFor(log)
                  return (
                  <div key={log.id} className="bg-surface border border-border rounded-2xl p-4 hover:border-border-strong transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-bold text-foreground text-lg">{log.total_cost != null ? `$${Number(log.total_cost).toFixed(2)}` : '—'}</span>
                          {log.mpg != null && (
                            outlierIds.has(log.id) ? (
                              <span className="bg-warn/10 text-warn text-xs font-bold px-2 py-1 rounded-lg border border-warn/20" title="Likely a missed fill-up before this — excluded from your average MPG">
                                ⚠ {Number(log.mpg).toFixed(1)} mpg
                              </span>
                            ) : (
                              <span className="bg-accent/10 text-accent text-xs font-bold px-2 py-1 rounded-lg border border-accent/20">
                                {Number(log.mpg).toFixed(1)} mpg
                              </span>
                            )
                          )}
                          {i === filteredLogs.length - 1 && log.mpg == null && period === 'all' && (
                            <span className="text-faint text-xs">First fillup</span>
                          )}
                        </div>
                        {log.mpg != null && (
                          outlierIds.has(log.id) ? (
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              <span className="text-warn text-xs">Not counted in MPG{missedFlags.has(log.id) && !manualExclude.has(log.id) ? ' (looks like a missed fill)' : ''}.</span>
                              <button onClick={() => markReal(log.id)} className="text-xs font-semibold text-accent hover:underline">It’s real, count it</button>
                            </div>
                          ) : (
                            <button onClick={() => markMissed(log.id)} className="mt-2 text-xs text-faint hover:text-muted transition-colors">Mark as missed fill</button>
                          )
                        )}
                        <div className="flex items-center gap-2 mt-1 text-sm text-muted flex-wrap">
                          <span>{format(parseISO(log.date), 'MMM d, yyyy')}</span>
                          <span>·</span>
                          <span>{log.odometer.toLocaleString()} mi</span>
                        </div>
                        {(log.gallons != null || log.price_per_gallon != null) && (
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-faint">
                            {log.gallons != null && <span>{Number(log.gallons).toFixed(3)} gal</span>}
                            {log.gallons != null && log.price_per_gallon != null && <span>·</span>}
                            {log.price_per_gallon != null && <span>${Number(log.price_per_gallon).toFixed(3)}/gal</span>}
                          </div>
                        )}
                        {saved != null && (saved >= 0.005 ? (
                          <p className="mt-1.5 text-xs font-medium text-success">Could’ve saved ${saved.toFixed(2)} driving efficiently</p>
                        ) : (
                          <p className="mt-1.5 text-xs text-faint">Best MPG this season</p>
                        ))}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => setFuelModal({ log })}
                          className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-muted hover:text-foreground transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeleteId(log.id)}
                          className="w-8 h-8 rounded-lg bg-surface-2 flex items-center justify-center text-muted hover:text-danger transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Add / Edit modal (shared with the dashboard quick-logger) */}
      {fuelModal && vehicle && (
        <FuelLogModal
          vehicle={vehicle}
          log={fuelModal.log}
          onClose={() => setFuelModal(null)}
          onSaved={() => { setFuelModal(null); load() }}
        />
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-xs text-center">
            <p className="font-bold text-foreground mb-2">Delete this fillup?</p>
            <p className="text-muted text-sm mb-6">This can&apos;t be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-3 transition-colors">
                Cancel
              </button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 bg-danger hover:opacity-90 text-white font-bold rounded-2xl py-3 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
