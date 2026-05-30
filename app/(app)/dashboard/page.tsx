'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, differenceInDays, parseISO, addMonths } from 'date-fns'
import {
  Gauge, Pencil, X, CircleAlert, TrendingUp, Settings, LogOut, RefreshCw,
  ChevronDown, ChevronRight, Car, CheckCircle2, Plus, Fuel,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import type { ServiceLog, FuelLog, ServiceCategory, ServiceCategoryProduct } from '@/lib/types'

const AddServiceFlow = dynamic(() => import('@/components/service/AddServiceFlow'), { ssr: false })

interface CategoryWithStatus {
  cat: ServiceCategory
  lastLog: ServiceLog | null
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

const FALLBACK_MILES_PER_MONTH = 1250

function projectedOdometer(baseOdo: number, serviceLogs: ServiceLog[], fuelLogs: FuelLog[], milesPerMonth: number): number {
  const readings = [
    ...serviceLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
    ...fuelLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const latest = readings[0]
  if (!latest || milesPerMonth <= 0) return baseOdo
  const daysSince = differenceInDays(new Date(), parseISO(latest.date))
  if (daysSince <= 0) return Math.max(baseOdo, latest.odo)
  return Math.max(baseOdo, latest.odo + Math.round((milesPerMonth / 30) * daysSince))
}

function calcMilesPerMonth(serviceLogs: ServiceLog[], fuelLogs: FuelLog[]): number {
  const readings = [
    ...serviceLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
    ...fuelLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  if (readings.length < 2) return FALLBACK_MILES_PER_MONTH
  const oldest = readings[0], newest = readings[readings.length - 1]
  const days = differenceInDays(parseISO(newest.date), parseISO(oldest.date))
  if (days < 30 || newest.odo <= oldest.odo) return FALLBACK_MILES_PER_MONTH
  return Math.round((newest.odo - oldest.odo) / days * 30)
}

function buildCategoryStatus(cat: ServiceCategory, logs: ServiceLog[], currentOdo: number): CategoryWithStatus {
  const catLogs = logs.filter(l => l.category_id === cat.id && l.odometer > 0).sort((a, b) => b.odometer - a.odometer)
  const last = catLogs[0] ?? null
  const lastOdo = last?.odometer ?? null
  const lastDate = last?.date ?? null
  const nextOdo = lastOdo != null && cat.interval_miles ? lastOdo + cat.interval_miles : cat.interval_miles ? currentOdo + cat.interval_miles : null
  const nextDate = lastDate != null && cat.interval_days
    ? format(new Date(new Date(lastDate).getTime() + cat.interval_days * 86400000), 'yyyy-MM-dd')
    : cat.interval_days ? format(new Date(Date.now() + cat.interval_days * 86400000), 'yyyy-MM-dd') : null
  const milesLeft = nextOdo != null ? nextOdo - currentOdo : null
  const daysLeft = nextDate != null ? differenceInDays(parseISO(nextDate), new Date()) : null
  const isOverdue = (milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft < 0)
  const isDueSoon = !isOverdue && ((milesLeft != null && milesLeft <= 500) || (daysLeft != null && daysLeft <= 30))
  return { cat, lastLog: last, lastOdo, lastDate, nextOdo, nextDate, milesLeft, daysLeft, isOverdue, isDueSoon }
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 shadow-xl">
      <p className="text-zinc-400 text-xs mb-1">{label}</p>
      <p className="text-zinc-100 text-sm font-semibold">${payload[0].value.toFixed(2)}</p>
    </div>
  )
}

export default function DashboardPage() {
  useAuth()
  const { vehicle, vehicles, setActiveVehicleId, refresh: refreshVehicle } = useVehicle()
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [serviceLogs, setServiceLogs] = useState<ServiceLog[]>([])
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([])
  const [allFuelLogs, setAllFuelLogs] = useState<FuelLog[]>([])
  const [products, setProducts] = useState<ServiceCategoryProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [showOdoModal, setShowOdoModal] = useState(false)
  const [newOdo, setNewOdo] = useState('')
  const [odoSaving, setOdoSaving] = useState(false)
  const [upcomingPeriod, setUpcomingPeriod] = useState<UpcomingPeriod>('3mo')
  const [showCarPicker, setShowCarPicker] = useState(false)
  const [showAddFlow, setShowAddFlow] = useState(false)

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true)
    try {
      const [{ data: cats }, { data: svcLogs }, { data: fuelChart }, { data: fuelAll }, { data: prods }] = await Promise.all([
        supabase.from('service_categories').select('*').eq('vehicle_id', vehicle.id).eq('category_type', 'maintenance').order('name'),
        supabase.from('service_logs').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }),
        supabase.from('fuel_logs').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }).limit(8),
        supabase.from('fuel_logs').select('id,date,odometer').eq('vehicle_id', vehicle.id).order('date', { ascending: true }),
        supabase.from('service_category_products').select('*').eq('vehicle_id', vehicle.id),
      ])
      setCategories(cats ?? [])
      setServiceLogs(svcLogs ?? [])
      setFuelLogs(((fuelChart ?? []) as FuelLog[]).reverse())
      setAllFuelLogs((fuelAll ?? []) as FuelLog[])
      setProducts(prods ?? [])
    } finally {
      setLoading(false)
    }
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
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  const milesPerMonth = calcMilesPerMonth(serviceLogs, allFuelLogs)
  const estOdo = projectedOdometer(vehicle.odometer, serviceLogs, allFuelLogs, milesPerMonth)
  const isProjected = estOdo > vehicle.odometer

  const categoryStatuses = categories
    .filter(cat => cat.interval_miles != null || cat.interval_days != null)
    .map(cat => buildCategoryStatus(cat, serviceLogs, estOdo))

  const overdueServices = categoryStatuses.filter(s => s.isOverdue)
  const dueSoonServices = categoryStatuses.filter(s => !s.isOverdue && s.isDueSoon)
  const overdueCount = overdueServices.length
  const dueSoonCount = dueSoonServices.length
  const healthScore = categoryStatuses.length ? Math.max(0, Math.round(((categoryStatuses.length - overdueCount) / categoryStatuses.length) * 100)) : 100
  const healthColor = healthScore >= 80 ? 'text-green-400' : healthScore >= 50 ? 'text-blue-400' : 'text-red-400'

  const totalFuelSpend = fuelLogs.reduce((s, f) => s + Number(f.total_cost), 0)
  const totalServiceSpend = serviceLogs.reduce((s, l) => s + Number(l.cost ?? 0), 0)
  const fuelChartData = fuelLogs.map(f => ({ date: format(parseISO(f.date), 'MMM d'), cost: Number(f.total_cost) }))
  const spendData = [{ name: 'Fuel', amount: totalFuelSpend }, { name: 'Service', amount: totalServiceSpend }]
  const lastFillup = fuelLogs.length > 0 ? fuelLogs[fuelLogs.length - 1] : null

  const selectedPeriod = UPCOMING_PERIODS.find(p => p.key === upcomingPeriod)!
  const periodCutoffDate = addMonths(new Date(), selectedPeriod.months)
  const periodCutoffMiles = vehicle.odometer + selectedPeriod.months * milesPerMonth

  const upcomingServices = categoryStatuses.filter(s =>
    s.isOverdue || (s.nextOdo != null && s.nextOdo <= periodCutoffMiles) || (s.nextDate != null && parseISO(s.nextDate) <= periodCutoffDate)
  )
  const upcomingCostItems = upcomingServices.map(s => {
    const catProds = products.filter(p => p.category_id === s.cat.id)
    let estimate: number | null = null
    if (catProds.length > 0 && catProds.some(p => p.last_price != null)) {
      estimate = catProds.reduce((sum, p) => sum + Number(p.last_price ?? 0), 0)
    } else {
      const catLogs = serviceLogs.filter(l => l.category_id === s.cat.id && l.cost != null)
      if (catLogs.length > 0) estimate = catLogs.slice(0, 3).reduce((sum, l) => sum + Number(l.cost), 0) / Math.min(catLogs.length, 3)
    }
    return { s, estimate }
  })
  const totalUpcomingCost = upcomingCostItems.reduce((sum, { estimate }) => sum + (estimate ?? 0), 0)

  const historicalReadings = [
    ...serviceLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
    ...allFuelLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
  ]

  // Build the services summary sentence
  const overdueNames = overdueServices.slice(0, 3).map(s => s.cat.name).join(', ')
  const dueSoonNames = dueSoonServices.slice(0, 3).map(s => s.cat.name).join(', ')

  return (
    <div className="bg-zinc-950 min-h-screen">

      {/* ─── Desktop slim header ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex shrink-0 h-12 px-4 items-center gap-3 border-b border-zinc-800">
        <button onClick={() => vehicles.length > 1 && setShowCarPicker(true)} className="flex items-center gap-1.5 group">
          <span className="font-bold text-sm text-zinc-100 group-hover:text-blue-400 transition-colors">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </span>
          {vehicles.length > 1 && <ChevronDown size={13} className="text-zinc-500 group-hover:text-blue-400 transition-colors" />}
        </button>
        <div className="h-4 w-px bg-zinc-800" />
        <button onClick={() => { setShowOdoModal(true); setNewOdo(String(vehicle.odometer)) }} className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors">
          <Gauge size={13} />
          <span className="text-sm tabular-nums font-semibold">{estOdo.toLocaleString()} mi</span>
          {isProjected && <span className="text-xs text-blue-500/70 bg-blue-500/10 px-1.5 py-0.5 rounded">est</span>}
        </button>
        {categoryStatuses.length > 0 && (
          <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${
            overdueCount > 0 ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : dueSoonCount > 0 ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
            : 'bg-green-500/10 border-green-500/20 text-green-400'
          }`}>
            {overdueCount > 0 ? <><CircleAlert size={10} /> {overdueCount} overdue</> : dueSoonCount > 0 ? <><CircleAlert size={10} /> {dueSoonCount} due soon</> : <><CheckCircle2 size={10} /> All current</>}
          </div>
        )}
        <span className={`text-xs font-bold ${healthColor}`}>{healthScore}% health</span>
        <div className="flex-1" />
        <button onClick={() => setShowAddFlow(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl px-3 py-1.5 transition-colors">
          <Plus size={13} /> Add Record
        </button>
        <div className="h-4 w-px bg-zinc-800" />
        <button onClick={load} className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"><RefreshCw size={14} /></button>
        <button onClick={() => supabase.auth.signOut()} className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"><LogOut size={14} /></button>
      </div>

      {/* ─── Mobile header ───────────────────────────────────────────────────── */}
      <div className="lg:hidden px-4 pt-10 pb-3">
        <div className="flex items-center justify-between">
          <button onClick={() => vehicles.length > 1 && setShowCarPicker(true)} className="flex items-center gap-1.5 group min-w-0">
            <h1 className="text-base font-bold text-zinc-100 group-hover:text-blue-400 transition-colors truncate">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            {vehicles.length > 1 && <ChevronDown size={14} className="text-zinc-500 group-hover:text-blue-400 shrink-0" />}
          </button>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button onClick={() => setShowAddFlow(true)} className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg px-2.5 py-1.5 transition-colors">
              <Plus size={11} /> Add
            </button>
            <button onClick={() => { setShowOdoModal(true); setNewOdo(String(vehicle.odometer)) }} className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500"><Gauge size={14} /></button>
            <button onClick={load} className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500"><RefreshCw size={14} /></button>
            <button onClick={() => supabase.auth.signOut()} className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500"><LogOut size={14} /></button>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <button onClick={() => { setShowOdoModal(true); setNewOdo(String(vehicle.odometer)) }} className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors">
            <span className="text-zinc-200 font-bold tabular-nums text-sm">{estOdo.toLocaleString()} mi</span>
            {isProjected && <span className="text-xs text-blue-500/70 bg-blue-500/10 px-1.5 py-0.5 rounded">est</span>}
          </button>
          <span className={`text-xs font-bold ${healthColor} ml-auto`}>{healthScore}%</span>
        </div>
      </div>

      {/* ─── Page content ────────────────────────────────────────────────────── */}
      <div className="px-4 pb-28 lg:pb-8 space-y-5 lg:max-w-3xl lg:mx-auto lg:pt-6">

        {/* Services summary card */}
        <Link href="/service" className="block">
          <div className={`rounded-2xl p-4 border cursor-pointer transition-colors hover:border-zinc-600 ${
            overdueCount > 0 ? 'bg-red-500/5 border-red-500/20'
            : dueSoonCount > 0 ? 'bg-blue-500/5 border-blue-500/20'
            : 'bg-zinc-900 border-zinc-800'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-zinc-100">Service Schedule</p>
              <ChevronRight size={14} className="text-zinc-500" />
            </div>
            {loading ? (
              <p className="text-zinc-600 text-sm">Loading…</p>
            ) : categoryStatuses.length === 0 ? (
              <p className="text-zinc-500 text-sm">No maintenance categories set up yet.</p>
            ) : (() => {
              // Most urgent item for headline
              const urgent = overdueServices[0] ?? dueSoonServices[0] ?? null
              const alertItems = [...overdueServices.slice(0, 2), ...dueSoonServices.slice(0, overdueServices.length >= 2 ? 0 : 2 - overdueServices.length)]
              const lastSvc = serviceLogs.filter(l => l.service_type).sort((a, b) => b.date.localeCompare(a.date))[0]
              return (
                <div className="space-y-3">
                  {/* Headline: most urgent */}
                  {urgent && (
                    <div className={`flex items-center gap-2 text-sm font-semibold ${urgent.isOverdue ? 'text-red-400' : 'text-blue-400'}`}>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${urgent.isOverdue ? 'bg-red-400' : 'bg-blue-400'}`} />
                      <span>{urgent.cat.name}</span>
                      <span className="font-normal text-zinc-400 text-xs">
                        {urgent.isOverdue ? 'overdue' : (
                          urgent.milesLeft != null && urgent.daysLeft != null
                            ? `in ${urgent.milesLeft.toLocaleString()} mi · ${urgent.daysLeft}d`
                            : urgent.milesLeft != null ? `in ${urgent.milesLeft.toLocaleString()} mi`
                            : urgent.daysLeft != null ? `in ${urgent.daysLeft}d` : ''
                        )}
                      </span>
                    </div>
                  )}

                  {/* Mini rows with progress for top alerts */}
                  {alertItems.map(s => {
                    if (s.cat.id === urgent?.cat.id) return null
                    return (
                      <div key={s.cat.id} className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.isOverdue ? 'bg-red-400' : 'bg-blue-400/70'}`} />
                        <span className="text-zinc-400 text-xs flex-1 truncate">{s.cat.name}</span>
                        <span className={`text-xs font-medium ${s.isOverdue ? 'text-red-400' : 'text-zinc-500'}`}>
                          {s.isOverdue ? 'overdue' : s.milesLeft != null ? `${s.milesLeft.toLocaleString()} mi` : `${s.daysLeft}d`}
                        </span>
                      </div>
                    )
                  })}

                  {/* Summary counts */}
                  <div className="flex items-center gap-3 pt-1 border-t border-zinc-800/60">
                    {overdueCount > 0 && <span className="text-red-400 text-xs font-semibold">{overdueCount} overdue</span>}
                    {dueSoonCount > 0 && <span className="text-blue-400 text-xs font-semibold">{dueSoonCount} due soon</span>}
                    {overdueCount === 0 && dueSoonCount === 0 && <span className="text-green-400 text-xs font-semibold">All {categoryStatuses.length} services current</span>}
                    {lastSvc && (
                      <span className="text-zinc-600 text-xs ml-auto truncate">Last: {lastSvc.service_type}, {format(parseISO(lastSvc.date), 'MMM d')}</span>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        </Link>

        {/* Fuel mini-row */}
        {lastFillup && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 flex items-center gap-3">
            <Fuel size={15} className="text-blue-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-zinc-500 text-xs">Last fillup · {format(parseISO(lastFillup.date), 'MMM d')}</p>
              <div className="flex items-center gap-3 mt-0.5">
                {lastFillup.mpg != null && <span className="text-zinc-200 text-sm font-semibold">{lastFillup.mpg.toFixed(1)} mpg</span>}
                <span className="text-zinc-400 text-sm">${Number(lastFillup.total_cost).toFixed(2)}</span>
                <span className="text-zinc-600 text-xs">· {lastFillup.gallons.toFixed(2)} gal</span>
              </div>
            </div>
          </div>
        )}

        {/* Upcoming cost */}
        {categoryStatuses.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-zinc-100">Upcoming Cost</p>
              <div className="flex gap-1">
                {UPCOMING_PERIODS.map(p => (
                  <button key={p.key} onClick={() => setUpcomingPeriod(p.key)}
                    className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${upcomingPeriod === p.key ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30' : 'text-zinc-600 hover:text-zinc-400'}`}
                  >{p.label}</button>
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
                        {s.milesLeft != null && s.milesLeft > 0 && <p className="text-zinc-600 text-xs">{s.milesLeft.toLocaleString()} mi away</p>}
                        {s.isOverdue && <p className="text-red-400 text-xs">Overdue</p>}
                      </div>
                      <span className={`text-sm font-semibold ${estimate != null ? 'text-blue-400' : 'text-zinc-600'}`}>{estimate != null ? `~$${estimate.toFixed(0)}` : '—'}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                  <span className="text-zinc-400 text-sm">Estimated total</span>
                  <span className="text-blue-400 font-bold">{totalUpcomingCost > 0 ? `~$${totalUpcomingCost.toFixed(0)}` : '—'}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Analytics grid */}
        <div className="grid lg:grid-cols-2 gap-4">
          {fuelChartData.length >= 2 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-blue-500" />
                <p className="text-sm font-semibold text-zinc-100">Fuel Cost Trend</p>
                <span className="text-zinc-600 text-xs ml-auto">last {fuelChartData.length} fillups</span>
              </div>
              <ResponsiveContainer width="100%" height={130}>
                <LineChart data={fuelChartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {(totalFuelSpend > 0 || totalServiceSpend > 0) && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <p className="text-sm font-semibold text-zinc-100 mb-3">Total Spend</p>
              <div className="flex gap-3 mb-3">
                <div className="flex-1 bg-zinc-800/60 rounded-xl p-3"><p className="text-xs text-zinc-500 mb-1">Fuel</p><p className="text-lg font-bold text-blue-400">${totalFuelSpend.toFixed(2)}</p></div>
                <div className="flex-1 bg-zinc-800/60 rounded-xl p-3"><p className="text-xs text-zinc-500 mb-1">Service</p><p className="text-lg font-bold text-blue-400">${totalServiceSpend.toFixed(2)}</p></div>
              </div>
              <ResponsiveContainer width="100%" height={90}>
                <BarChart data={spendData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="amount" radius={[5, 5, 0, 0]}>
                    <Cell fill="#f59e0b" /><Cell fill="#3b82f6" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {!loading && categories.length === 0 && serviceLogs.length === 0 && fuelLogs.length === 0 && (
          <div className="text-center py-12">
            <Settings size={36} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400 font-medium">No data yet</p>
            <p className="text-zinc-600 text-sm mt-1">Add a service or fuel log to get started</p>
          </div>
        )}
      </div>

      {/* ─── Car Picker ───────────────────────────────────────────────────────── */}
      {showCarPicker && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end" onClick={() => setShowCarPicker(false)}>
          <div className="w-full bg-zinc-900 border-t border-zinc-800 rounded-t-3xl p-5 pb-10" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />
            <p className="text-zinc-400 text-xs font-medium uppercase tracking-widest mb-3">Switch Vehicle</p>
            <div className="space-y-2">
              {vehicles.map(v => (
                <button key={v.id} onClick={() => { setActiveVehicleId(v.id); setShowCarPicker(false) }}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-colors ${v.id === vehicle.id ? 'bg-blue-500/10 border-blue-500/30' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'}`}
                >
                  <Car size={16} className={v.id === vehicle.id ? 'text-blue-500' : 'text-zinc-500'} />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-zinc-100 font-semibold text-sm">{v.year} {v.make} {v.model}</p>
                    {v.trim && <p className="text-zinc-500 text-xs">{v.trim}</p>}
                  </div>
                  {v.id === vehicle.id && <CheckCircle2 size={15} className="text-blue-500 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Odometer Modal ──────────────────────────────────────────────────── */}
      {showOdoModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-zinc-100">Update Odometer</h3>
              <button onClick={() => setShowOdoModal(false)} className="text-zinc-500 hover:text-zinc-300"><X size={18} /></button>
            </div>
            <input type="number" value={newOdo} onChange={e => setNewOdo(e.target.value)} min={vehicle.odometer}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 text-2xl font-bold tabular-nums focus:outline-none focus:border-blue-500/70 transition-all mb-2" autoFocus />
            <p className="text-zinc-600 text-xs mb-4">Current: {vehicle.odometer.toLocaleString()} mi — must be equal or higher</p>
            <div className="flex gap-3">
              <button onClick={() => setShowOdoModal(false)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-2.5 transition-colors">Cancel</button>
              <button onClick={saveOdometer} disabled={odoSaving || !newOdo || parseInt(newOdo) < vehicle.odometer}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-2xl py-2.5 transition-colors">
                {odoSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddFlow && (
        <AddServiceFlow
          vehicle={vehicle}
          categories={categories}
          historicalReadings={historicalReadings}
          milesPerMonth={milesPerMonth}
          onClose={() => setShowAddFlow(false)}
          onSaved={() => { setShowAddFlow(false); load() }}
        />
      )}
    </div>
  )
}
