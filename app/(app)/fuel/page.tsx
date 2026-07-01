'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { format, parseISO, subDays, subMonths, subYears, getMonth } from 'date-fns'
import { Plus, Trash2, Pencil, Fuel, TrendingUp } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { withRetry, withTimeout } from '@/lib/recover'
import { getCache, setCache } from '@/lib/cache'
import FuelLogModal from '@/components/fuel/FuelLogModal'
import type { FuelLog } from '@/lib/types'

type Period = 'week' | 'month' | '3mo' | 'year' | 'all'

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

const ChartTooltip = ({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-border-strong rounded-xl px-3 py-2 shadow-xl">
      <p className="text-muted text-xs mb-1">{label}</p>
      <p className="text-foreground text-sm font-bold">{payload[0].value.toFixed(1)} mpg</p>
    </div>
  )
}

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
  const [period, setPeriod] = useState<Period>('all')
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
    await supabase.from('fuel_logs').delete().eq('id', id)
    setDeleteId(null)
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

  const stats = [
    { label: 'Avg MPG', value: avgMpg ? avgMpg.toFixed(1) : '—', accent: true },
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              {stats.map(s => (
                <div key={s.label} className="bg-surface border border-border rounded-2xl p-4">
                  <p className={`text-2xl lg:text-3xl font-bold tracking-tight ${s.accent ? 'text-accent' : 'text-foreground'}`}>{s.value}</p>
                  <p className="text-xs text-muted mt-1">{s.label}</p>
                </div>
              ))}
            </div>

            {/* MPG Trend + Seasonal: side by side on laptop */}
            <div className="grid lg:grid-cols-3 gap-4 mb-4">
              {chartData.length >= 2 && (
                <div className={`bg-surface border border-border rounded-2xl p-4 ${hasSeasonalData ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp size={16} className="text-accent" />
                    <p className="text-sm font-semibold text-foreground">MPG Trend</p>
                  </div>
                  <div className="h-[200px] lg:h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                        <Tooltip content={<ChartTooltip />} />
                        <Line type="monotone" dataKey="mpg" stroke="#f59e0b" strokeWidth={2.5} dot={{ fill: '#f59e0b', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#f59e0b', strokeWidth: 0 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
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
                {filteredLogs.map((log, i) => (
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
                ))}
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
