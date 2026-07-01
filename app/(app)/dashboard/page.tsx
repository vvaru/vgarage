'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, differenceInDays, parseISO, addMonths, isSameMonth } from 'date-fns'
import {
  Gauge, X, CircleAlert, TrendingUp, Settings, LogOut, RefreshCw,
  ChevronDown, ChevronRight, Car, CheckCircle2, Fuel, Wrench,
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
import { withRetry, withTimeout } from '@/lib/recover'
import type { ServiceLog, FuelLog, ServiceCategory, ServiceCategoryProduct } from '@/lib/types'

const AddServiceFlow = dynamic(() => import('@/components/service/AddServiceFlow'), { ssr: false })
const FuelLogModal = dynamic(() => import('@/components/fuel/FuelLogModal'), { ssr: false })

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

function heroProgress(s: CategoryWithStatus | null): number {
  if (!s) return 100
  if (s.isOverdue) return 100
  if (s.cat.interval_miles && s.milesLeft != null) {
    return Math.min(100, Math.max(4, Math.round(((s.cat.interval_miles - s.milesLeft) / s.cat.interval_miles) * 100)))
  }
  if (s.cat.interval_days && s.daysLeft != null) {
    return Math.min(100, Math.max(4, Math.round(((s.cat.interval_days - s.daysLeft) / s.cat.interval_days) * 100)))
  }
  return 50
}

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-border-strong rounded-xl px-3 py-2 shadow-xl">
      <p className="text-muted text-xs mb-1">{label}</p>
      <p className="text-foreground text-sm font-semibold">${payload[0].value.toFixed(2)}</p>
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
  const [showFuelModal, setShowFuelModal] = useState(false)

  const gridStroke = '#27272a'

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true)
    try {
      const [{ data: cats }, { data: svcLogs }, { data: fuelChart }, { data: fuelAll }, { data: prods }] = await withRetry(() => withTimeout(Promise.all([
        supabase.from('service_categories').select('*').eq('vehicle_id', vehicle.id).eq('category_type', 'maintenance').order('name'),
        supabase.from('service_logs').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }),
        supabase.from('fuel_logs').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }).limit(8),
        supabase.from('fuel_logs').select('id,date,odometer').eq('vehicle_id', vehicle.id).order('date', { ascending: true }),
        supabase.from('service_category_products').select('*').eq('vehicle_id', vehicle.id),
      ]), 8000))
      setCategories(cats ?? [])
      setServiceLogs(svcLogs ?? [])
      setFuelLogs(((fuelChart ?? []) as FuelLog[]).reverse())
      setAllFuelLogs((fuelAll ?? []) as FuelLog[])
      setProducts(prods ?? [])
    } catch { /* both attempts failed — leave existing data, finally clears spinner */ } finally {
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
    return <div className="min-h-screen bg-background flex items-center justify-center"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
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

  // Soonest item drives the hero progress + subtitle
  const sortedByUrgency = [...categoryStatuses].sort((a, b) => (a.milesLeft ?? Infinity) - (b.milesLeft ?? Infinity))
  const nextService = sortedByUrgency[0] ?? null
  const heroPct = heroProgress(nextService)
  const heroBar = nextService?.isOverdue ? 'bg-danger' : nextService?.isDueSoon ? 'bg-warn' : 'bg-accent'

  let nextText = 'No service schedule yet'
  if (nextService) {
    if (nextService.isOverdue) nextText = `${nextService.cat.name} overdue`
    else if (nextService.milesLeft != null) nextText = `${nextService.cat.name} in ${nextService.milesLeft.toLocaleString()} mi`
    else if (nextService.daysLeft != null) nextText = `${nextService.cat.name} in ${nextService.daysLeft}d`
  }

  const greetHour = new Date().getHours()
  const greeting = greetHour < 12 ? 'Good morning' : greetHour < 18 ? 'Good afternoon' : 'Good evening'

  const mpgVals = fuelLogs.map(f => f.mpg).filter((m): m is number => m != null)
  const avgMpg = mpgVals.length ? mpgVals.reduce((a, b) => a + b, 0) / mpgVals.length : null
  const monthSpend = fuelLogs.filter(f => isSameMonth(parseISO(f.date), new Date())).reduce((s, f) => s + Number(f.total_cost), 0)

  const totalFuelSpend = fuelLogs.reduce((s, f) => s + Number(f.total_cost), 0)
  const totalServiceSpend = serviceLogs.reduce((s, l) => s + Number(l.cost ?? 0), 0)
  const fuelChartData = fuelLogs.map(f => ({ date: format(parseISO(f.date), 'MMM d'), cost: Number(f.total_cost) }))
  const spendData = [{ name: 'Fuel', amount: totalFuelSpend }, { name: 'Service', amount: totalServiceSpend }]

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

  // The list of services to show in the "Due soon" card (overdue first, then due soon)
  const dueListItems = [...overdueServices, ...dueSoonServices].slice(0, 4)

  return (
    <div className="bg-background min-h-screen">
      <div className="px-4 lg:px-8 pt-10 lg:pt-8 pb-28 lg:pb-12 max-w-xl lg:max-w-6xl mx-auto space-y-4">

        {/* ─── Header: greeting + vehicle + quick icons ───────────────────────── */}
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-muted text-sm font-medium">{greeting}</p>
            <button onClick={() => vehicles.length > 1 && setShowCarPicker(true)} className="flex items-center gap-1.5 group min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-foreground truncate group-hover:text-accent transition-colors">
                {vehicle.make} {vehicle.model}
              </h1>
              {vehicles.length > 1 && <ChevronDown size={18} className="text-muted group-hover:text-accent shrink-0" />}
            </button>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button onClick={load} className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-muted hover:text-foreground transition-colors"><RefreshCw size={15} /></button>
            <button onClick={() => supabase.auth.signOut()} className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-muted hover:text-foreground transition-colors"><LogOut size={15} /></button>
          </div>
        </div>

        {/* ─── Hero + actions (side-by-side on laptop) ────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-3xl bg-gradient-to-b from-surface to-surface/60 border border-border p-5">
          <button onClick={() => { setShowOdoModal(true); setNewOdo(String(vehicle.odometer)) }} className="flex items-baseline gap-2 group">
            <span className="text-[2.75rem] leading-none font-bold tracking-tight tabular-nums text-foreground">{estOdo.toLocaleString()}</span>
            <span className="text-muted font-semibold">mi</span>
            {isProjected && <span className="text-[11px] text-accent bg-accent/10 px-1.5 py-0.5 rounded font-medium">est</span>}
            <Gauge size={15} className="text-faint group-hover:text-muted transition-colors ml-0.5" />
          </button>
          <p className="text-muted text-sm mt-2 truncate">
            {vehicle.year}{vehicle.trim ? ` · ${vehicle.trim}` : ''} · {nextText}
          </p>
          <div className="mt-4 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div className={`h-full rounded-full ${heroBar} transition-all`} style={{ width: `${heroPct}%` }} />
          </div>
        </div>

        {/* Primary actions */}
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 lg:content-start">
          <button onClick={() => setShowFuelModal(true)} className="rounded-2xl bg-accent hover:bg-accent-hover text-accent-foreground p-4 flex flex-col gap-2 transition-colors shadow-sm shadow-accent/20 text-left">
            <Fuel size={20} />
            <span className="font-semibold text-sm">Log fuel</span>
          </button>
          <button onClick={() => setShowAddFlow(true)} className="rounded-2xl bg-surface border border-border hover:border-border-strong text-foreground p-4 flex flex-col gap-2 transition-colors text-left">
            <Wrench size={20} className="text-accent" />
            <span className="font-semibold text-sm">Log service</span>
          </button>
        </div>
        </div>

        {/* ─── Info cards (2-column on laptop) ─────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-start">
        {/* Service status / Due soon */}
        <Link href="/service" className="block">
          <div className="rounded-2xl bg-surface border border-border p-4 hover:border-border-strong transition-colors">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-foreground">Service</p>
              <div className="flex items-center gap-2">
                {categoryStatuses.length > 0 && (
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                    overdueCount > 0 ? 'bg-danger/10 text-danger'
                    : dueSoonCount > 0 ? 'bg-warn/10 text-warn'
                    : 'bg-success/10 text-success'
                  }`}>
                    {overdueCount > 0 ? <><CircleAlert size={10} /> {overdueCount} overdue</>
                      : dueSoonCount > 0 ? <><CircleAlert size={10} /> {dueSoonCount} due soon</>
                      : <><CheckCircle2 size={10} /> All current</>}
                  </span>
                )}
                <ChevronRight size={15} className="text-muted" />
              </div>
            </div>
            {loading ? (
              <p className="text-faint text-sm">Loading…</p>
            ) : categoryStatuses.length === 0 ? (
              <p className="text-muted text-sm">No maintenance categories set up yet.</p>
            ) : dueListItems.length === 0 ? (
              <p className="text-success text-sm font-medium">All {categoryStatuses.length} services up to date 🎉</p>
            ) : (
              <div className="space-y-2.5">
                {dueListItems.map(s => (
                  <div key={s.cat.id} className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.isOverdue ? 'bg-danger' : 'bg-warn'}`} />
                    <span className="text-foreground text-sm flex-1 truncate">{s.cat.name}</span>
                    <span className={`text-xs font-semibold ${s.isOverdue ? 'text-danger' : 'text-muted'}`}>
                      {s.isOverdue ? 'overdue' : s.milesLeft != null ? `${s.milesLeft.toLocaleString()} mi` : `${s.daysLeft}d`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Link>

        {/* ─── Stat tiles ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface border border-border p-4">
            <p className="text-2xl font-bold tracking-tight text-foreground">{avgMpg != null ? avgMpg.toFixed(1) : '—'}</p>
            <p className="text-muted text-xs mt-0.5">avg mpg</p>
          </div>
          <div className="rounded-2xl bg-surface border border-border p-4">
            <p className="text-2xl font-bold tracking-tight text-foreground">${monthSpend.toFixed(0)}</p>
            <p className="text-muted text-xs mt-0.5">fuel this month</p>
          </div>
        </div>

        {/* ─── Upcoming cost ───────────────────────────────────────────────────── */}
        {categoryStatuses.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-foreground">Upcoming Cost</p>
              <div className="flex gap-1">
                {UPCOMING_PERIODS.map(p => (
                  <button key={p.key} onClick={() => setUpcomingPeriod(p.key)}
                    className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${upcomingPeriod === p.key ? 'bg-accent/15 text-accent border border-accent/30' : 'text-faint hover:text-muted'}`}
                  >{p.label}</button>
                ))}
              </div>
            </div>
            {upcomingServices.length === 0 ? (
              <p className="text-faint text-sm">No services due within {selectedPeriod.label}</p>
            ) : (
              <>
                <div className="space-y-2 mb-3">
                  {upcomingCostItems.map(({ s, estimate }) => (
                    <div key={s.cat.id} className="flex items-center justify-between">
                      <div>
                        <p className="text-foreground text-sm">{s.cat.name}</p>
                        {s.milesLeft != null && s.milesLeft > 0 && <p className="text-faint text-xs">{s.milesLeft.toLocaleString()} mi away</p>}
                        {s.isOverdue && <p className="text-danger text-xs">Overdue</p>}
                      </div>
                      <span className={`text-sm font-semibold ${estimate != null ? 'text-accent' : 'text-faint'}`}>{estimate != null ? `~$${estimate.toFixed(0)}` : '—'}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-muted text-sm">Estimated total</span>
                  <span className="text-accent font-bold">{totalUpcomingCost > 0 ? `~$${totalUpcomingCost.toFixed(0)}` : '—'}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ─── Analytics ───────────────────────────────────────────────────────── */}
        {fuelChartData.length >= 2 && (
          <div className="bg-surface border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={14} className="text-accent" />
              <p className="text-sm font-semibold text-foreground">Fuel Cost Trend</p>
              <span className="text-faint text-xs ml-auto">last {fuelChartData.length} fillups</span>
            </div>
            <ResponsiveContainer width="100%" height={130}>
              <LineChart data={fuelChartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#8a8a93', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8a8a93', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {(totalFuelSpend > 0 || totalServiceSpend > 0) && (
          <div className="bg-surface border border-border rounded-2xl p-4">
            <p className="text-sm font-semibold text-foreground mb-3">Total Spend</p>
            <div className="flex gap-3 mb-3">
              <div className="flex-1 bg-surface-2 rounded-xl p-3"><p className="text-xs text-muted mb-1">Fuel</p><p className="text-lg font-bold text-accent">${totalFuelSpend.toFixed(2)}</p></div>
              <div className="flex-1 bg-surface-2 rounded-xl p-3"><p className="text-xs text-muted mb-1">Service</p><p className="text-lg font-bold text-accent">${totalServiceSpend.toFixed(2)}</p></div>
            </div>
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={spendData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#8a8a93', fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8a8a93', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="amount" radius={[5, 5, 0, 0]}>
                  <Cell fill="#f59e0b" /><Cell fill="#3b82f6" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {!loading && categories.length === 0 && serviceLogs.length === 0 && fuelLogs.length === 0 && (
          <div className="text-center py-12 lg:col-span-2">
            <Settings size={36} className="text-faint mx-auto mb-3" />
            <p className="text-muted font-medium">No data yet</p>
            <p className="text-faint text-sm mt-1">Tap “Log fuel” or “Log service” to get started</p>
          </div>
        )}
        </div>
      </div>

      {/* ─── Car Picker ───────────────────────────────────────────────────────── */}
      {showCarPicker && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end" onClick={() => setShowCarPicker(false)}>
          <div className="w-full bg-surface border-t border-border rounded-t-3xl p-5 pb-10" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-border-strong rounded-full mx-auto mb-5" />
            <p className="text-muted text-xs font-medium uppercase tracking-widest mb-3">Switch Vehicle</p>
            <div className="space-y-2">
              {vehicles.map(v => (
                <button key={v.id} onClick={() => { setActiveVehicleId(v.id); setShowCarPicker(false) }}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-colors ${v.id === vehicle.id ? 'bg-accent/10 border-accent/30' : 'bg-surface-2 border-border hover:border-border-strong'}`}
                >
                  <Car size={16} className={v.id === vehicle.id ? 'text-accent' : 'text-muted'} />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-foreground font-semibold text-sm">{v.year} {v.make} {v.model}</p>
                    {v.trim && <p className="text-muted text-xs">{v.trim}</p>}
                  </div>
                  {v.id === vehicle.id && <CheckCircle2 size={15} className="text-accent shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Odometer Modal ──────────────────────────────────────────────────── */}
      {showOdoModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-5 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">Update Odometer</h3>
              <button onClick={() => setShowOdoModal(false)} className="text-muted hover:text-foreground"><X size={18} /></button>
            </div>
            <input type="number" value={newOdo} onChange={e => setNewOdo(e.target.value)} min={vehicle.odometer}
              className="w-full bg-surface-2 border border-border rounded-xl px-4 py-3 text-foreground text-2xl font-bold tabular-nums focus:outline-none focus:border-accent transition-all mb-2" autoFocus />
            <p className="text-faint text-xs mb-4">Current: {vehicle.odometer.toLocaleString()} mi — must be equal or higher</p>
            <div className="flex gap-3">
              <button onClick={() => setShowOdoModal(false)} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-2.5 transition-colors">Cancel</button>
              <button onClick={saveOdometer} disabled={odoSaving || !newOdo || parseInt(newOdo) < vehicle.odometer}
                className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-foreground font-bold rounded-2xl py-2.5 transition-colors">
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

      {showFuelModal && (
        <FuelLogModal
          vehicle={vehicle}
          onClose={() => setShowFuelModal(false)}
          onSaved={() => { setShowFuelModal(false); load() }}
        />
      )}
    </div>
  )
}
