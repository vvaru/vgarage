'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, differenceInDays, parseISO, addMonths } from 'date-fns'
import { Gauge, Pencil, X, CircleAlert, TrendingUp, Settings, LogOut, RefreshCw } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import type { ServiceLog, FuelLog, ServiceCategory, ServiceCategoryProduct } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────
interface CategoryWithStatus {
  cat: ServiceCategory
  lastOdo: number | null
  lastDate: string | null
  nextOdo: number | null
  nextDate: string | null
  milesLeft: number | null
  daysLeft: number | null
  isOverdue: boolean
  isDueSoon: boolean
}

type UpcomingPeriod = '1mo' | '3mo' | '6mo' | '1yr'

const UPCOMING_PERIODS: { key: UpcomingPeriod; label: string; months: number }[] = [
  { key: '1mo', label: '1 mo', months: 1 },
  { key: '3mo', label: '3 mo', months: 3 },
  { key: '6mo', label: '6 mo', months: 6 },
  { key: '1yr', label: '1 yr', months: 12 },
]

const MILES_PER_MONTH = 1250 // ~15k/year

function buildCategoryStatus(cat: ServiceCategory, logs: ServiceLog[], currentOdo: number): CategoryWithStatus {
  const catLogs = logs
    .filter(l => l.category_id === cat.id && l.odometer > 0)
    .sort((a, b) => b.odometer - a.odometer)

  const last = catLogs[0] ?? null
  const lastOdo = last?.odometer ?? null
  const lastDate = last?.date ?? null

  const nextOdo = lastOdo != null && cat.interval_miles
    ? lastOdo + cat.interval_miles
    : cat.interval_miles
    ? currentOdo + cat.interval_miles
    : null

  const nextDate = lastDate != null && cat.interval_days
    ? format(new Date(new Date(lastDate).getTime() + cat.interval_days * 86400000), 'yyyy-MM-dd')
    : cat.interval_days
    ? format(new Date(Date.now() + cat.interval_days * 86400000), 'yyyy-MM-dd')
    : null

  const milesLeft = nextOdo != null ? nextOdo - currentOdo : null
  const daysLeft = nextDate != null ? differenceInDays(parseISO(nextDate), new Date()) : null

  const isOverdue =
    (milesLeft != null && milesLeft <= 0) ||
    (daysLeft != null && daysLeft < 0)

  const isDueSoon = !isOverdue && (
    (milesLeft != null && milesLeft <= 500) ||
    (daysLeft != null && daysLeft <= 30)
  )

  return { cat, lastOdo, lastDate, nextOdo, nextDate, milesLeft, daysLeft, isOverdue, isDueSoon }
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
      <p className="text-zinc-100 text-sm font-semibold">${payload[0].value.toFixed(2)}</p>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { vehicle, refresh: refreshVehicle } = useVehicle()
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [serviceLogs, setServiceLogs] = useState<ServiceLog[]>([])
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([])
  const [products, setProducts] = useState<ServiceCategoryProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [showOdoModal, setShowOdoModal] = useState(false)
  const [newOdo, setNewOdo] = useState('')
  const [odoSaving, setOdoSaving] = useState(false)
  const [upcomingPeriod, setUpcomingPeriod] = useState<UpcomingPeriod>('3mo')

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true)
    const [{ data: cats }, { data: svcLogs }, { data: fuel }, { data: prods }] = await Promise.all([
      supabase.from('service_categories').select('*').eq('vehicle_id', vehicle.id).eq('category_type', 'maintenance').order('name'),
      supabase.from('service_logs').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }),
      supabase.from('fuel_logs').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }).limit(6),
      supabase.from('service_category_products').select('*').eq('vehicle_id', vehicle.id),
    ])
    setCategories(cats ?? [])
    setServiceLogs(svcLogs ?? [])
    setFuelLogs((fuel ?? []).reverse())
    setProducts(prods ?? [])
    setLoading(false)
  }, [vehicle])

  useEffect(() => { load() }, [load])

  async function saveOdometer() {
    if (!vehicle || !newOdo) return
    const val = parseInt(newOdo)
    if (isNaN(val) || val < vehicle.odometer) return
    setOdoSaving(true)
    await supabase.from('vehicles').update({ odometer: val }).eq('id', vehicle.id)
    await refreshVehicle()
    setShowOdoModal(false)
    setNewOdo('')
    setOdoSaving(false)
  }

  if (!vehicle) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  // ─── Derived data ──────────────────────────────────────────────────────────
  const categoryStatuses = categories.map(cat => buildCategoryStatus(cat, serviceLogs, vehicle.odometer))

  const overdueCount = categoryStatuses.filter(s => s.isOverdue).length
  const healthScore = categoryStatuses.length
    ? Math.max(0, Math.round(((categoryStatuses.length - overdueCount) / categoryStatuses.length) * 100))
    : 100

  const totalFuelSpend = fuelLogs.reduce((s, f) => s + Number(f.total_cost), 0)
  const totalServiceSpend = serviceLogs.reduce((s, l) => s + Number(l.cost ?? 0), 0)

  const fuelChartData = fuelLogs.map(f => ({
    date: format(parseISO(f.date), 'MMM d'),
    cost: Number(f.total_cost),
  }))

  const spendData = [
    { name: 'Fuel', amount: totalFuelSpend },
    { name: 'Service', amount: totalServiceSpend },
  ]

  // ─── Upcoming cost ─────────────────────────────────────────────────────────
  const selectedPeriod = UPCOMING_PERIODS.find(p => p.key === upcomingPeriod)!
  const periodCutoffDate = addMonths(new Date(), selectedPeriod.months)
  const periodCutoffMiles = vehicle.odometer + selectedPeriod.months * MILES_PER_MONTH

  const upcomingServices = categoryStatuses.filter(s => {
    const dueByMiles = s.nextOdo != null && s.nextOdo <= periodCutoffMiles
    const dueByDate = s.nextDate != null && parseISO(s.nextDate) <= periodCutoffDate
    return s.isOverdue || dueByMiles || dueByDate
  })

  const upcomingCostItems = upcomingServices.map(s => {
    const catProds = products.filter(p => p.category_id === s.cat.id)
    let estimate: number | null = null

    if (catProds.length > 0 && catProds.some(p => p.last_price != null)) {
      estimate = catProds.reduce((sum, p) => sum + Number(p.last_price ?? 0), 0)
    } else {
      const catLogs = serviceLogs.filter(l => l.category_id === s.cat.id && l.cost != null)
      if (catLogs.length > 0) {
        estimate = catLogs.slice(0, 3).reduce((sum, l) => sum + Number(l.cost), 0) / Math.min(catLogs.length, 3)
      }
    }

    return { s, estimate }
  })

  const totalUpcomingCost = upcomingCostItems.reduce((sum, { estimate }) => sum + (estimate ?? 0), 0)

  const healthColor = healthScore >= 80 ? 'text-green-400' : healthScore >= 50 ? 'text-amber-400' : 'text-red-400'
  const lastService = serviceLogs[0]

  return (
    <div className="bg-zinc-950 min-h-screen">
      {/* Header */}
      <div className="px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">My Vehicle</p>
          <h1 className="text-xl font-bold text-zinc-100 mt-0.5">{vehicle.year} {vehicle.make} {vehicle.model}</h1>
          {vehicle.trim && <p className="text-zinc-500 text-sm">{vehicle.trim}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => supabase.auth.signOut()} className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors">
            <LogOut size={16} />
          </button>
        </div>
      </div>

      <div className="px-4 space-y-4 pb-6">
        {/* Odometer */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-zinc-500">
              <Gauge size={16} />
              <span className="text-xs font-medium uppercase tracking-wide">Odometer</span>
            </div>
            <button
              onClick={() => { setShowOdoModal(true); setNewOdo(String(vehicle.odometer)) }}
              className="flex items-center gap-1.5 text-amber-500 text-xs font-medium hover:text-amber-400 transition-colors"
            >
              <Pencil size={13} /> Update
            </button>
          </div>
          <p className="text-4xl font-bold text-zinc-100 mt-2 tabular-nums">{vehicle.odometer.toLocaleString()}</p>
          <p className="text-zinc-500 text-sm">miles</p>
        </div>

        {/* Health Score */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3">Vehicle Health</p>
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 shrink-0">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="26" fill="none" stroke="#27272a" strokeWidth="6" />
                <circle
                  cx="32" cy="32" r="26" fill="none"
                  stroke={healthScore >= 80 ? '#4ade80' : healthScore >= 50 ? '#f59e0b' : '#f87171'}
                  strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={`${(healthScore / 100) * 163.4} 163.4`}
                />
              </svg>
              <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${healthColor}`}>
                {healthScore}%
              </span>
            </div>
            <div>
              <p className={`text-lg font-bold ${healthColor}`}>
                {healthScore >= 80 ? 'Good' : healthScore >= 50 ? 'Fair' : 'Needs Attention'}
              </p>
              <p className="text-zinc-500 text-sm">
                {overdueCount > 0 ? `${overdueCount} service${overdueCount > 1 ? 's' : ''} overdue` : 'All services current'}
              </p>
            </div>
          </div>
        </div>

        {/* Upcoming services */}
        {categoryStatuses.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3">Upcoming Services</p>
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
              {categoryStatuses
                .sort((a, b) => {
                  if (a.isOverdue && !b.isOverdue) return -1
                  if (!a.isOverdue && b.isOverdue) return 1
                  if (a.isDueSoon && !b.isDueSoon) return -1
                  if (!a.isDueSoon && b.isDueSoon) return 1
                  return (a.milesLeft ?? 9999) - (b.milesLeft ?? 9999)
                })
                .map(s => {
                  const border = s.isOverdue ? 'border-red-500/40' : s.isDueSoon ? 'border-amber-500/40' : 'border-zinc-800'
                  const badge = s.isOverdue
                    ? 'bg-red-500/10 text-red-400'
                    : s.isDueSoon
                    ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-zinc-800 text-zinc-400'

                  return (
                    <div key={s.cat.id} className={`shrink-0 w-36 bg-zinc-900 border ${border} rounded-2xl p-3.5`}>
                      <p className="text-zinc-100 text-sm font-semibold leading-tight mb-2">{s.cat.name}</p>
                      <div className={`inline-flex items-center gap-1 text-xs font-medium rounded-lg px-2 py-1 ${badge} mb-2`}>
                        {s.isOverdue && <CircleAlert size={11} />}
                        {s.isOverdue ? 'Overdue' : s.isDueSoon ? 'Due Soon' : 'OK'}
                      </div>
                      {s.milesLeft != null && (
                        <p className="text-zinc-400 text-xs">
                          {s.milesLeft > 0 ? `${s.milesLeft.toLocaleString()} mi left` : `${Math.abs(s.milesLeft).toLocaleString()} mi over`}
                        </p>
                      )}
                      {s.nextOdo && (
                        <p className="text-zinc-600 text-xs">@ {s.nextOdo.toLocaleString()} mi</p>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
        )}

        {/* Upcoming Cost */}
        {categoryStatuses.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-zinc-100">Upcoming Cost</p>
              <div className="flex gap-1">
                {UPCOMING_PERIODS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setUpcomingPeriod(p.key)}
                    className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                      upcomingPeriod === p.key
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        : 'text-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {upcomingServices.length === 0 ? (
              <p className="text-zinc-600 text-sm">No services due within {selectedPeriod.label}</p>
            ) : (
              <>
                <div className="space-y-2 mb-3">
                  {upcomingCostItems.map(({ s, estimate }) => (
                    <div key={s.cat.id} className="flex items-center justify-between">
                      <div>
                        <p className="text-zinc-300 text-sm">{s.cat.name}</p>
                        {s.milesLeft != null && s.milesLeft > 0 && (
                          <p className="text-zinc-600 text-xs">{s.milesLeft.toLocaleString()} mi away</p>
                        )}
                        {s.isOverdue && <p className="text-red-400 text-xs">Overdue</p>}
                      </div>
                      <span className={`text-sm font-semibold ${estimate != null ? 'text-amber-400' : 'text-zinc-600'}`}>
                        {estimate != null ? `~$${estimate.toFixed(0)}` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                  <span className="text-zinc-400 text-sm">Estimated total</span>
                  <span className="text-amber-400 font-bold">
                    {totalUpcomingCost > 0 ? `~$${totalUpcomingCost.toFixed(0)}` : '—'}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Fuel Cost Trend */}
        {fuelChartData.length >= 2 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={16} className="text-amber-500" />
              <p className="text-sm font-semibold text-zinc-100">Fuel Cost Trend</p>
              <span className="text-zinc-600 text-xs ml-auto">last {fuelChartData.length} fillups</span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={fuelChartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2.5} dot={{ fill: '#f59e0b', r: 3, strokeWidth: 0 }} activeDot={{ r: 5, fill: '#f59e0b', strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Spend by Category */}
        {(totalFuelSpend > 0 || totalServiceSpend > 0) && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-sm font-semibold text-zinc-100 mb-4">Total Spend</p>
            <div className="flex gap-4 mb-4">
              <div className="flex-1 bg-zinc-800/60 rounded-xl p-3">
                <p className="text-xs text-zinc-500 mb-1">Fuel</p>
                <p className="text-lg font-bold text-amber-400">${totalFuelSpend.toFixed(2)}</p>
              </div>
              <div className="flex-1 bg-zinc-800/60 rounded-xl p-3">
                <p className="text-xs text-zinc-500 mb-1">Service</p>
                <p className="text-lg font-bold text-blue-400">${totalServiceSpend.toFixed(2)}</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={spendData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                  <Cell fill="#f59e0b" />
                  <Cell fill="#3b82f6" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Last Service */}
        {lastService && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-3">Last Service</p>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-zinc-100 font-semibold">{lastService.service_type}</p>
                <p className="text-zinc-500 text-sm mt-0.5">
                  {format(parseISO(lastService.date), 'MMM d, yyyy')} · {lastService.odometer.toLocaleString()} mi
                </p>
                {lastService.shop_name && (
                  <p className="text-zinc-600 text-xs mt-0.5">
                    {lastService.shop_name}{lastService.shop_location ? `, ${lastService.shop_location}` : ''}
                  </p>
                )}
              </div>
              {lastService.cost != null && (
                <span className="text-amber-400 font-bold text-lg ml-4">${Number(lastService.cost).toFixed(2)}</span>
              )}
            </div>
          </div>
        )}

        {!loading && categories.length === 0 && serviceLogs.length === 0 && fuelLogs.length === 0 && (
          <div className="text-center py-12">
            <Settings size={40} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400 font-medium">No data yet</p>
            <p className="text-zinc-600 text-sm mt-1">Add a service or fuel log to get started</p>
          </div>
        )}
      </div>

      {/* Odometer Update Modal */}
      {showOdoModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-zinc-100">Update Odometer</h3>
              <button onClick={() => setShowOdoModal(false)} className="text-zinc-500 hover:text-zinc-300"><X size={20} /></button>
            </div>
            <input
              type="number"
              value={newOdo}
              onChange={e => setNewOdo(e.target.value)}
              min={vehicle.odometer}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 text-2xl font-bold tabular-nums focus:outline-none focus:border-amber-500/70 transition-all mb-2"
              autoFocus
            />
            <p className="text-zinc-600 text-xs mb-4">Current: {vehicle.odometer.toLocaleString()} mi — must be equal or higher</p>
            <div className="flex gap-3">
              <button onClick={() => setShowOdoModal(false)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button
                onClick={saveOdometer}
                disabled={odoSaving || !newOdo || parseInt(newOdo) < vehicle.odometer}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-3 transition-colors"
              >
                {odoSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
