'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, parseISO, subDays, subMonths, subYears, getMonth } from 'date-fns'
import { Plus, Trash2, X, Fuel, TrendingUp } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { useTabFocusRefresh } from '@/lib/useTabFocusRefresh'
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

const EMPTY_FORM = {
  date: format(new Date(), 'yyyy-MM-dd'),
  odometer: '',
  gallons: '',
  price_per_gallon: '',
}

const ChartTooltip = ({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 shadow-xl">
      <p className="text-zinc-400 text-xs mb-1">{label}</p>
      <p className="text-zinc-100 text-sm font-bold">{payload[0].value.toFixed(1)} mpg</p>
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

export default function FuelPage() {
  const { user } = useAuth()
  const { vehicle } = useVehicle()
  const [logs, setLogs] = useState<FuelLog[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('all')

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true)
    try {
      const { data } = await supabase
        .from('fuel_logs')
        .select('*')
        .eq('vehicle_id', vehicle.id)
        .order('date', { ascending: false })
      setLogs(data ?? [])
    } finally {
      setLoading(false)
    }
  }, [vehicle])

  useEffect(() => { load() }, [load])
  useTabFocusRefresh(load)

  function openAdd() {
    setForm({ ...EMPTY_FORM, odometer: vehicle ? String(vehicle.odometer) : '' })
    setShowForm(true)
  }

  function calcMpg(currentOdo: number, gallons: number): number | null {
    const prevLog = logs.find(l => l.odometer < currentOdo)
    if (!prevLog) return null
    const miles = currentOdo - prevLog.odometer
    if (miles <= 0 || gallons <= 0) return null
    return miles / gallons
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!vehicle || !user) return
    setSaving(true)

    const odo = parseInt(form.odometer)
    const gals = parseFloat(form.gallons)
    const ppg = parseFloat(form.price_per_gallon)
    const total = parseFloat((gals * ppg).toFixed(2))
    const mpg = calcMpg(odo, gals)

    await supabase.from('fuel_logs').insert({
      user_id: user.id,
      vehicle_id: vehicle.id,
      date: form.date,
      odometer: odo,
      gallons: gals,
      price_per_gallon: ppg,
      total_cost: total,
      mpg: mpg ? parseFloat(mpg.toFixed(2)) : null,
    })

    if (odo > vehicle.odometer) {
      await supabase.from('vehicles').update({ odometer: odo }).eq('id', vehicle.id)
    }

    await load()
    setShowForm(false)
    setSaving(false)
  }

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

  const withMpg = filteredLogs.filter(l => l.mpg != null)
  const avgMpg = withMpg.length
    ? withMpg.reduce((s, l) => s + Number(l.mpg), 0) / withMpg.length
    : null

  const totalSpend = filteredLogs.reduce((s, l) => s + Number(l.total_cost), 0)
  const totalGallons = filteredLogs.reduce((s, l) => s + Number(l.gallons), 0)

  const chartData = [...filteredLogs]
    .filter(l => l.mpg != null)
    .reverse()
    .map(l => ({
      date: format(parseISO(l.date), 'MMM d'),
      mpg: Number(l.mpg),
    }))

  // Seasonal averages (always use all logs)
  const seasonalAvgs = SEASONS.map(season => {
    const seasonLogs = logs.filter(l => {
      const m = getMonth(parseISO(l.date))
      return season.months.includes(m) && l.mpg != null
    })
    const avg = seasonLogs.length
      ? seasonLogs.reduce((s, l) => s + Number(l.mpg), 0) / seasonLogs.length
      : null
    return { label: season.label, avg, count: seasonLogs.length }
  })

  const hasSeasonalData = seasonalAvgs.some(s => s.avg != null)

  const preview = form.gallons && form.price_per_gallon
    ? parseFloat(form.gallons) * parseFloat(form.price_per_gallon)
    : null

  return (
    <div className="bg-zinc-950 min-h-screen">
      {/* Header */}
      <div className="px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">Log</p>
          <h1 className="text-xl font-bold text-zinc-100 mt-0.5">Fuel Log</h1>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl px-4 py-2.5 text-sm transition-colors shadow-lg shadow-blue-500/20"
        >
          <Plus size={16} />
          Add
        </button>
      </div>

      {/* Period filter */}
      {logs.length > 0 && (
        <div className="px-4 mb-4 flex gap-2 overflow-x-auto scrollbar-hide">
          {PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                period === p.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Stats */}
      {logs.length > 0 && (
        <div className="px-4 mb-4 grid grid-cols-3 gap-2">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-blue-400">
              {avgMpg ? avgMpg.toFixed(1) : '—'}
            </p>
            <p className="text-xs text-zinc-500">Avg MPG</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-zinc-100">${totalSpend.toFixed(0)}</p>
            <p className="text-xs text-zinc-500">Total Spent</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-lg font-bold text-zinc-100">{totalGallons.toFixed(0)}</p>
            <p className="text-xs text-zinc-500">Gallons</p>
          </div>
        </div>
      )}

      {/* MPG Trend Chart */}
      {chartData.length >= 2 && (
        <div className="mx-4 mb-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} className="text-blue-500" />
            <p className="text-sm font-semibold text-zinc-100">MPG Trend</p>
          </div>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#71717a', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                domain={['auto', 'auto']}
              />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="mpg"
                stroke="#f59e0b"
                strokeWidth={2.5}
                dot={{ fill: '#f59e0b', r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#f59e0b', strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Seasonal Averages */}
      {hasSeasonalData && (
        <div className="mx-4 mb-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-sm font-semibold text-zinc-100 mb-3">Seasonal MPG</p>
          <div className="grid grid-cols-4 gap-2">
            {seasonalAvgs.map(s => (
              <div key={s.label} className="text-center">
                <p className={`text-base font-bold ${s.avg != null ? 'text-blue-400' : 'text-zinc-600'}`}>
                  {s.avg != null ? s.avg.toFixed(1) : '—'}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
                {s.count > 0 && (
                  <p className="text-zinc-700 text-xs">{s.count} fill{s.count === 1 ? '' : 's'}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log list */}
      <div className="px-4 space-y-2 pb-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div className="text-center py-16">
            <Fuel size={40} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400 font-medium">No fuel records yet</p>
            <p className="text-zinc-600 text-sm mt-1">Tap + Add after every fillup to track MPG</p>
          </div>
        )}

        {!loading && filteredLogs.length === 0 && logs.length > 0 && (
          <div className="text-center py-8">
            <p className="text-zinc-500 text-sm">No fillups in this period</p>
          </div>
        )}

        {filteredLogs.map((log, i) => (
          <div
            key={log.id}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-bold text-zinc-100 text-lg">
                    ${Number(log.total_cost).toFixed(2)}
                  </span>
                  {log.mpg != null && (
                    <span className="bg-blue-500/10 text-blue-400 text-xs font-bold px-2 py-1 rounded-lg border border-blue-500/20">
                      {Number(log.mpg).toFixed(1)} mpg
                    </span>
                  )}
                  {i === 0 && log.mpg == null && (
                    <span className="text-zinc-600 text-xs">First fillup</span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500 flex-wrap">
                  <span>{format(parseISO(log.date), 'MMM d, yyyy')}</span>
                  <span>·</span>
                  <span>{log.odometer.toLocaleString()} mi</span>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-600">
                  <span>{Number(log.gallons).toFixed(3)} gal</span>
                  <span>·</span>
                  <span>${Number(log.price_per_gallon).toFixed(3)}/gal</span>
                </div>
              </div>
              <button
                onClick={() => setDeleteId(log.id)}
                className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-red-400 transition-colors shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-zinc-100 text-lg">Log Fillup</h3>
              <button onClick={() => setShowForm(false)} className="text-zinc-500 hover:text-zinc-300">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Odometer (mi)</label>
                  <input
                    type="number"
                    placeholder="24500"
                    value={form.odometer}
                    onChange={e => setForm(f => ({ ...f, odometer: e.target.value }))}
                    required
                    min="0"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Gallons</label>
                  <input
                    type="number"
                    placeholder="10.500"
                    value={form.gallons}
                    onChange={e => setForm(f => ({ ...f, gallons: e.target.value }))}
                    required
                    min="0.001"
                    step="0.001"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Price/gal ($)</label>
                  <input
                    type="number"
                    placeholder="3.299"
                    value={form.price_per_gallon}
                    onChange={e => setForm(f => ({ ...f, price_per_gallon: e.target.value }))}
                    required
                    min="0.001"
                    step="0.001"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 focus:ring-1 focus:ring-blue-500/30 transition-all"
                  />
                </div>
              </div>

              {preview != null && (
                <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-zinc-400 text-sm">Total cost</span>
                  <span className="text-blue-400 font-bold text-lg">${preview.toFixed(2)}</span>
                </div>
              )}

              {logs.length === 0 && (
                <p className="text-zinc-600 text-xs bg-zinc-800/60 rounded-xl px-3 py-2">
                  MPG will be calculated starting from your second fillup.
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-xs text-center">
            <p className="font-bold text-zinc-100 mb-2">Delete this fillup?</p>
            <p className="text-zinc-500 text-sm mb-6">This can&apos;t be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                className="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold rounded-2xl py-3 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
