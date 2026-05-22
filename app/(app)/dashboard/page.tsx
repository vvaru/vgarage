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
import dynamic from 'next/dynamic'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import type { ServiceLog, FuelLog, ServiceCategory, ServiceCategoryProduct } from '@/lib/types'

const AddServiceFlow = dynamic(() => import('@/components/service/AddServiceFlow'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function getUsagePct(s: CategoryWithStatus, currentOdo: number): number {
  let pct = 0
  if (s.lastOdo != null && s.cat.interval_miles) pct = Math.max(pct, (currentOdo - s.lastOdo) / s.cat.interval_miles)
  if (s.lastDate != null && s.cat.interval_days) pct = Math.max(pct, differenceInDays(new Date(), parseISO(s.lastDate)) / s.cat.interval_days)
  return Math.min(pct, 1)
}

function getTimeLabel(s: CategoryWithStatus): { label: string; colorClass: string } {
  if (s.isOverdue) return { label: 'Overdue', colorClass: 'text-red-400' }
  if (s.daysLeft != null && s.daysLeft >= 0) {
    const months = Math.round(s.daysLeft / 30)
    if (months < 1) return { label: `${s.daysLeft}d left`, colorClass: s.isDueSoon ? 'text-amber-400' : 'text-zinc-400' }
    return { label: `${months} mo left`, colorClass: s.isDueSoon ? 'text-amber-400' : 'text-zinc-400' }
  }
  if (s.milesLeft != null && s.milesLeft > 0) return { label: `${s.milesLeft.toLocaleString()} mi`, colorClass: s.isDueSoon ? 'text-amber-400' : 'text-zinc-400' }
  if (!s.lastLog) return { label: 'No records', colorClass: 'text-zinc-600' }
  return { label: 'OK', colorClass: 'text-green-400' }
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

// ─── Page ─────────────────────────────────────────────────────────────────────
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
  const [selectedStatus, setSelectedStatus] = useState<CategoryWithStatus | null>(null)
  const [showAddFlow, setShowAddFlow] = useState(false)
  const [editingInterval, setEditingInterval] = useState<CategoryWithStatus | null>(null)
  const [editIntervalMonths, setEditIntervalMonths] = useState('')
  const [editIntervalMiles, setEditIntervalMiles] = useState('')
  const [intervalSaving, setIntervalSaving] = useState(false)

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true)
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

  async function saveInterval() {
    if (!editingInterval) return
    setIntervalSaving(true)
    const days = editIntervalMonths.trim() ? Math.round(parseFloat(editIntervalMonths) * 30) : null
    const miles = editIntervalMiles.trim() ? parseInt(editIntervalMiles) : null
    await supabase.from('service_categories').update({ interval_days: days, interval_miles: miles }).eq('id', editingInterval.cat.id)
    setEditingInterval(null)
    await load()
    setIntervalSaving(false)
  }

  if (!vehicle) {
    return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  // ─── Derived data ──────────────────────────────────────────────────────────
  const milesPerMonth = calcMilesPerMonth(serviceLogs, allFuelLogs)
  const estOdo = projectedOdometer(vehicle.odometer, serviceLogs, allFuelLogs, milesPerMonth)
  const isProjected = estOdo > vehicle.odometer

  const categoryStatuses = categories
    .filter(cat => cat.interval_miles != null || cat.interval_days != null)
    .map(cat => buildCategoryStatus(cat, serviceLogs, estOdo)).sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1
    if (!a.isOverdue && b.isOverdue) return 1
    if (a.isDueSoon && !b.isDueSoon) return -1
    if (!a.isDueSoon && b.isDueSoon) return 1
    return getUsagePct(b, estOdo) - getUsagePct(a, estOdo)
  })

  const sel = selectedStatus ?? categoryStatuses[0] ?? null

  const overdueCount = categoryStatuses.filter(s => s.isOverdue).length
  const dueSoonCount = categoryStatuses.filter(s => !s.isOverdue && s.isDueSoon).length
  const healthScore = categoryStatuses.length ? Math.max(0, Math.round(((categoryStatuses.length - overdueCount) / categoryStatuses.length) * 100)) : 100
  const healthColor = healthScore >= 80 ? 'text-green-400' : healthScore >= 50 ? 'text-amber-400' : 'text-red-400'

  const totalFuelSpend = fuelLogs.reduce((s, f) => s + Number(f.total_cost), 0)
  const totalServiceSpend = serviceLogs.reduce((s, l) => s + Number(l.cost ?? 0), 0)
  const fuelChartData = fuelLogs.map(f => ({ date: format(parseISO(f.date), 'MMM d'), cost: Number(f.total_cost) }))
  const spendData = [{ name: 'Fuel', amount: totalFuelSpend }, { name: 'Service', amount: totalServiceSpend }]
  const lastFillup = fuelLogs.length > 0 ? fuelLogs[fuelLogs.length - 1] : null

  const selectedPeriod = UPCOMING_PERIODS.find(p => p.key === upcomingPeriod)!
  const periodCutoffDate = addMonths(new Date(), selectedPeriod.months)
  const periodCutoffMiles = vehicle.odometer + selectedPeriod.months * milesPerMonth

  const upcomingServices = categoryStatuses.filter(s => {
    return s.isOverdue || (s.nextOdo != null && s.nextOdo <= periodCutoffMiles) || (s.nextDate != null && parseISO(s.nextDate) <= periodCutoffDate)
  })
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

  // ─── Detail data for selected service ─────────────────────────────────────
  function getDetailNums(s: CategoryWithStatus) {
    let milesUsed: number | null = null, milesPct = 0, daysUsed: number | null = null, daysPct = 0
    if (s.lastOdo != null && s.cat.interval_miles) { milesUsed = estOdo - s.lastOdo; milesPct = Math.min(milesUsed / s.cat.interval_miles, 1) }
    if (s.lastDate != null && s.cat.interval_days) { daysUsed = differenceInDays(new Date(), parseISO(s.lastDate)); daysPct = Math.min(daysUsed / s.cat.interval_days, 1) }
    return { milesUsed, milesPct, daysUsed, daysPct }
  }

  // ─── Detail panel content ─────────────────────────────────────────────────
  const renderDetailContent = (s: CategoryWithStatus) => {
    const { milesUsed, milesPct, daysUsed, daysPct } = getDetailNums(s)
    const barClass = s.isOverdue ? 'bg-red-500' : s.isDueSoon ? 'bg-amber-500' : 'bg-blue-500'
    const catLogs = serviceLogs.filter(l => l.category_id === s.cat.id).sort((a, b) => b.date.localeCompare(a.date))

    const intervalLabel = [
      s.cat.interval_days ? `${Math.round(s.cat.interval_days / 30)} mo` : null,
      s.cat.interval_miles ? `${s.cat.interval_miles.toLocaleString()} mi` : null,
    ].filter(Boolean).join(' · ') || 'Not set'

    return (
      <div className="p-4 space-y-4">
        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-zinc-100">{s.cat.name}</h2>
            <p className="text-zinc-600 text-xs mt-0.5">Every {intervalLabel}</p>
          </div>
          <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 ${
            s.isOverdue ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : s.isDueSoon ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            : 'bg-green-500/10 border-green-500/20 text-green-400'
          }`}>
            {s.isOverdue ? <><CircleAlert size={10} /> Overdue</> : s.isDueSoon ? <><CircleAlert size={10} /> Due Soon</> : <><CheckCircle2 size={10} /> Current</>}
          </div>
        </div>

        {/* Two cards: Upcoming + Since Last */}
        <div className="grid grid-cols-2 gap-3">
          {/* Upcoming card */}
          <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-2xl p-3.5 space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Upcoming</p>
            {s.nextDate ? (
              <p className="text-zinc-100 font-bold text-sm leading-tight">{format(parseISO(s.nextDate), 'MMM d, yyyy')}</p>
            ) : (
              <p className="text-zinc-600 text-sm">—</p>
            )}
            {s.isOverdue ? (
              <p className="text-red-400 text-xs font-semibold">Past due</p>
            ) : s.daysLeft != null && s.daysLeft >= 0 ? (
              <p className={`text-xs font-medium ${s.isDueSoon ? 'text-amber-400' : 'text-zinc-400'}`}>
                {s.daysLeft < 30 ? `${s.daysLeft}d left` : `${Math.round(s.daysLeft / 30)} mo left`}
              </p>
            ) : s.milesLeft != null && s.milesLeft > 0 ? (
              <p className={`text-xs font-medium ${s.isDueSoon ? 'text-amber-400' : 'text-zinc-400'}`}>{s.milesLeft.toLocaleString()} mi left</p>
            ) : null}
            {s.nextOdo != null && (
              <p className="text-zinc-600 text-xs">At {s.nextOdo.toLocaleString()} mi</p>
            )}
            {/* Interval inline edit */}
            <div className="pt-2 border-t border-zinc-700/50 flex items-center justify-between">
              <p className="text-zinc-600 text-xs">{intervalLabel}</p>
              <button
                onClick={() => {
                  setEditingInterval(s)
                  setEditIntervalMonths(s.cat.interval_days ? String(Math.round(s.cat.interval_days / 30)) : '')
                  setEditIntervalMiles(s.cat.interval_miles ? String(s.cat.interval_miles) : '')
                }}
                className="text-zinc-700 hover:text-amber-400 transition-colors ml-2"
              >
                <Pencil size={11} />
              </button>
            </div>
          </div>

          {/* Since Last card */}
          <div className="bg-zinc-800/60 border border-zinc-700/60 rounded-2xl p-3.5 space-y-2">
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Since Last</p>
            {s.lastLog ? (
              <>
                {daysUsed != null && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-zinc-500 text-xs">Time</span>
                      <span className="text-zinc-200 text-xs font-semibold">{Math.round(daysUsed / 30)} mo</span>
                    </div>
                    {s.cat.interval_days && (
                      <div className="w-full bg-zinc-700/60 rounded-full h-1">
                        <div className={`h-1 rounded-full ${barClass}`} style={{ width: `${Math.min(daysPct * 100, 100)}%` }} />
                      </div>
                    )}
                  </div>
                )}
                {milesUsed != null && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-zinc-500 text-xs">Miles</span>
                      <span className="text-zinc-200 text-xs font-semibold">{milesUsed.toLocaleString()} mi</span>
                    </div>
                    {s.cat.interval_miles && (
                      <div className="w-full bg-zinc-700/60 rounded-full h-1">
                        <div className={`h-1 rounded-full ${barClass}`} style={{ width: `${Math.min(milesPct * 100, 100)}%` }} />
                      </div>
                    )}
                  </div>
                )}
                <div className="pt-2 border-t border-zinc-700/50">
                  <p className="text-zinc-400 text-xs font-medium">{format(parseISO(s.lastLog.date), 'MMM d, yyyy')}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-zinc-600 text-xs">{s.lastLog.odometer.toLocaleString()} mi{s.lastLog.shop_name ? ` · ${s.lastLog.shop_name}` : ''}</p>
                    {s.lastLog.cost != null && <span className="text-amber-400 text-xs font-bold">${Number(s.lastLog.cost).toFixed(2)}</span>}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center">
                <p className="text-zinc-600 text-sm">No records yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Category service history */}
        {catLogs.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Service History</p>
            <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-2xl overflow-hidden">
              {catLogs.map((log, i) => (
                <div key={log.id} className={`px-4 py-3 ${i < catLogs.length - 1 ? 'border-b border-zinc-800/60' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-zinc-200 text-sm font-medium">{format(parseISO(log.date), 'MMM d, yyyy')}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-zinc-500 text-xs">{log.odometer.toLocaleString()} mi</span>
                        {log.shop_name && <span className="text-zinc-600 text-xs">· {log.shop_name}</span>}
                        {log.performed_by === 'owner' && <span className="text-blue-400/70 text-xs">· DIY</span>}
                      </div>
                      {log.notes && <p className="text-zinc-600 text-xs mt-1 italic">&ldquo;{log.notes}&rdquo;</p>}
                    </div>
                    {log.cost != null && <span className="text-amber-400 text-sm font-bold shrink-0">${Number(log.cost).toFixed(2)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {catLogs.length === 0 && !s.lastLog && (
          <div className="text-center py-4">
            <p className="text-zinc-600 text-sm">No service history for this category.</p>
            <button onClick={() => setShowAddFlow(true)} className="text-amber-500 text-xs mt-1 hover:text-amber-400 transition-colors">Add first record →</button>
          </div>
        )}
      </div>
    )
  }

  // ─── Analytics (left column, shared mobile + desktop) ─────────────────────
  const renderAnalytics = () => (
    <>
      {categoryStatuses.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-sm font-semibold text-zinc-100">Upcoming Cost</p>
            <div className="flex gap-1">
              {UPCOMING_PERIODS.map(p => (
                <button key={p.key} onClick={() => setUpcomingPeriod(p.key)}
                  className={`px-2 py-0.5 rounded-lg text-xs font-medium transition-colors ${upcomingPeriod === p.key ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'text-zinc-600 hover:text-zinc-400'}`}
                >{p.label}</button>
              ))}
            </div>
          </div>
          {upcomingServices.length === 0 ? (
            <p className="text-zinc-600 text-sm">No services due within {selectedPeriod.label}</p>
          ) : (
            <>
              <div className="space-y-1.5 mb-2.5">
                {upcomingCostItems.map(({ s, estimate }) => (
                  <div key={s.cat.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-zinc-300 text-sm">{s.cat.name}</p>
                      {s.milesLeft != null && s.milesLeft > 0 && <p className="text-zinc-600 text-xs">{s.milesLeft.toLocaleString()} mi away</p>}
                      {s.isOverdue && <p className="text-red-400 text-xs">Overdue</p>}
                    </div>
                    <span className={`text-sm font-semibold ${estimate != null ? 'text-amber-400' : 'text-zinc-600'}`}>{estimate != null ? `~$${estimate.toFixed(0)}` : '—'}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-400 text-sm">Estimated total</span>
                <span className="text-amber-400 font-bold">{totalUpcomingCost > 0 ? `~$${totalUpcomingCost.toFixed(0)}` : '—'}</span>
              </div>
            </>
          )}
        </div>
      )}

      {fuelChartData.length >= 2 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-amber-500" />
            <p className="text-sm font-semibold text-zinc-100">Fuel Cost Trend</p>
            <span className="text-zinc-600 text-xs ml-auto">last {fuelChartData.length} fillups</span>
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <LineChart data={fuelChartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4, fill: '#f59e0b', strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {(totalFuelSpend > 0 || totalServiceSpend > 0) && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5">
          <p className="text-sm font-semibold text-zinc-100 mb-3">Total Spend</p>
          <div className="flex gap-3 mb-3">
            <div className="flex-1 bg-zinc-800/60 rounded-xl p-2.5"><p className="text-xs text-zinc-500 mb-0.5">Fuel</p><p className="text-base font-bold text-amber-400">${totalFuelSpend.toFixed(2)}</p></div>
            <div className="flex-1 bg-zinc-800/60 rounded-xl p-2.5"><p className="text-xs text-zinc-500 mb-0.5">Service</p><p className="text-base font-bold text-blue-400">${totalServiceSpend.toFixed(2)}</p></div>
          </div>
          <ResponsiveContainer width="100%" height={90}>
            <BarChart data={spendData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#71717a', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="amount" radius={[5, 5, 0, 0]}>
                <Cell fill="#f59e0b" /><Cell fill="#3b82f6" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!loading && categories.length === 0 && serviceLogs.length === 0 && fuelLogs.length === 0 && (
        <div className="text-center py-10">
          <Settings size={36} className="text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-400 font-medium">No data yet</p>
          <p className="text-zinc-600 text-sm mt-1">Add a service or fuel log to get started</p>
        </div>
      )}
    </>
  )

  return (
    <div className="bg-zinc-950 min-h-screen lg:h-screen lg:flex lg:flex-col">

      {/* ─── Desktop slim header ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex shrink-0 h-12 px-4 items-center gap-3 border-b border-zinc-800">
        <button
          onClick={() => vehicles.length > 1 && setShowCarPicker(true)}
          className="flex items-center gap-1.5 group"
        >
          <span className="font-bold text-sm text-zinc-100 group-hover:text-amber-400 transition-colors">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </span>
          {vehicles.length > 1 && <ChevronDown size={13} className="text-zinc-500 group-hover:text-amber-400 transition-colors" />}
        </button>
        <div className="h-4 w-px bg-zinc-800" />
        <button
          onClick={() => { setShowOdoModal(true); setNewOdo(String(vehicle.odometer)) }}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <Gauge size={13} />
          <span className="text-sm tabular-nums font-semibold">{estOdo.toLocaleString()} mi</span>
          {isProjected && <span className="text-xs text-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 rounded">est</span>}
        </button>
        {categoryStatuses.length > 0 && (
          <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${
            overdueCount > 0 ? 'bg-red-500/10 border-red-500/20 text-red-400'
            : dueSoonCount > 0 ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            : 'bg-green-500/10 border-green-500/20 text-green-400'
          }`}>
            {overdueCount > 0 ? <><CircleAlert size={10} /> {overdueCount} overdue</> : dueSoonCount > 0 ? <><CircleAlert size={10} /> {dueSoonCount} due soon</> : <><CheckCircle2 size={10} /> All current</>}
          </div>
        )}
        <span className={`text-xs font-bold ${healthColor}`}>{healthScore}% health</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowAddFlow(true)}
          className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm rounded-xl px-3 py-1.5 transition-colors"
        >
          <Plus size={13} /> Add Record
        </button>
        <div className="h-4 w-px bg-zinc-800" />
        <button onClick={load} className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"><RefreshCw size={14} /></button>
        <button onClick={() => supabase.auth.signOut()} className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"><LogOut size={14} /></button>
      </div>

      {/* ─── Mobile header ───────────────────────────────────────────────────── */}
      <div className="lg:hidden px-4 pt-10 pb-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => vehicles.length > 1 && setShowCarPicker(true)}
            className="flex items-center gap-1.5 group min-w-0"
          >
            <h1 className="text-base font-bold text-zinc-100 group-hover:text-amber-400 transition-colors truncate">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </h1>
            {vehicles.length > 1 && <ChevronDown size={14} className="text-zinc-500 group-hover:text-amber-400 shrink-0" />}
          </button>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button
              onClick={() => setShowAddFlow(true)}
              className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-lg px-2.5 py-1.5 transition-colors"
            >
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
            {isProjected && <span className="text-xs text-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 rounded">est</span>}
          </button>
          {categoryStatuses.length > 0 && (
            <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${
              overdueCount > 0 ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : dueSoonCount > 0 ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-green-500/10 border-green-500/20 text-green-400'
            }`}>
              {overdueCount > 0 ? `${overdueCount} overdue` : dueSoonCount > 0 ? `${dueSoonCount} due soon` : 'All current'}
            </div>
          )}
          <span className={`text-xs font-bold ${healthColor} ml-auto`}>{healthScore}%</span>
        </div>
      </div>

      {/* ─── Two-column content area ─────────────────────────────────────────── */}
      <div className="lg:flex lg:flex-1 lg:overflow-hidden">

        {/* Left: service list + fuel + analytics */}
        <div className="lg:w-72 xl:w-80 lg:border-r lg:border-zinc-800 lg:overflow-y-auto lg:flex-shrink-0">
          <div className="px-3 pt-3 space-y-3 pb-28 lg:pb-6">

            {/* Service list */}
            {categoryStatuses.length > 0 && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-1.5 px-1">Maintenance</p>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                  {categoryStatuses.map((s, i) => {
                    const pct = getUsagePct(s, estOdo)
                    const { label, colorClass } = getTimeLabel(s)
                    const barColor = s.isOverdue ? 'bg-red-500' : s.isDueSoon ? 'bg-amber-500' : 'bg-blue-500'
                    const isLast = i === categoryStatuses.length - 1
                    const isSelected = sel?.cat.id === s.cat.id
                    return (
                      <button
                        key={s.cat.id}
                        onClick={() => setSelectedStatus(s)}
                        className={`w-full flex items-center gap-2.5 px-3 py-3 text-left transition-colors ${!isLast ? 'border-b border-zinc-800/60' : ''} ${isSelected ? 'bg-zinc-800/80 lg:border-l-2 lg:border-l-amber-500' : 'hover:bg-zinc-800/40 active:bg-zinc-800'}`}
                      >
                        <div className={`w-2 h-2 rounded-full shrink-0 ${s.isOverdue ? 'bg-red-400' : s.isDueSoon ? 'bg-amber-400' : 'bg-green-500'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className={`text-sm font-medium truncate ${isSelected ? 'text-amber-400' : 'text-zinc-100'}`}>{s.cat.name}</p>
                            <p className={`text-xs font-semibold ml-2 shrink-0 ${colorClass}`}>{label}</p>
                          </div>
                          <div className="w-full bg-zinc-800 rounded-full h-1">
                            <div className={`h-1 rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                          </div>
                        </div>
                        <ChevronRight size={12} className={`shrink-0 transition-colors ${isSelected ? 'text-amber-500' : 'text-zinc-700'}`} />
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Fuel mini-row */}
            {lastFillup && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-3 py-2.5 flex items-center gap-2.5">
                <Fuel size={14} className="text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-zinc-500 text-xs">Last fillup · {format(parseISO(lastFillup.date), 'MMM d')}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {lastFillup.mpg != null && <span className="text-zinc-200 text-xs font-semibold">{lastFillup.mpg.toFixed(1)} mpg</span>}
                    <span className="text-zinc-500 text-xs">${Number(lastFillup.total_cost).toFixed(2)}</span>
                    <span className="text-zinc-600 text-xs">· {lastFillup.gallons.toFixed(2)} gal</span>
                  </div>
                </div>
              </div>
            )}

            {/* Analytics */}
            {renderAnalytics()}
          </div>
        </div>

        {/* Right: detail panel (desktop only) */}
        <div className="hidden lg:flex lg:flex-1 lg:overflow-y-auto lg:flex-col">
          {sel ? (
            <div className="p-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                {renderDetailContent(sel)}
              </div>
            </div>
          ) : (
            !loading && categoryStatuses.length === 0 && (
              <div className="flex items-center justify-center flex-1 text-center p-8">
                <div>
                  <Settings size={36} className="text-zinc-700 mx-auto mb-3" />
                  <p className="text-zinc-400 font-medium">No maintenance categories</p>
                  <p className="text-zinc-600 text-sm mt-1">Add categories to track service intervals</p>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* ─── Mobile: detail bottom sheet ────────────────────────────────────── */}
      {selectedStatus && (
        <div className="lg:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end" onClick={() => setSelectedStatus(null)}>
          <div className="w-full bg-zinc-900 border-t border-zinc-800 rounded-t-3xl max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm pt-3 pb-2 px-4">
              <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto" />
            </div>
            {renderDetailContent(selectedStatus)}
            <div className="pb-8" />
          </div>
        </div>
      )}

      {/* ─── Car Picker ───────────────────────────────────────────────────────── */}
      {showCarPicker && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end" onClick={() => setShowCarPicker(false)}>
          <div className="w-full bg-zinc-900 border-t border-zinc-800 rounded-t-3xl p-5 pb-10" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mb-5" />
            <p className="text-zinc-400 text-xs font-medium uppercase tracking-widest mb-3">Switch Vehicle</p>
            <div className="space-y-2">
              {vehicles.map(v => (
                <button key={v.id} onClick={() => { setActiveVehicleId(v.id); setShowCarPicker(false) }}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-colors ${v.id === vehicle.id ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'}`}
                >
                  <Car size={16} className={v.id === vehicle.id ? 'text-amber-500' : 'text-zinc-500'} />
                  <div className="text-left flex-1 min-w-0">
                    <p className="text-zinc-100 font-semibold text-sm">{v.year} {v.make} {v.model}</p>
                    {v.trim && <p className="text-zinc-500 text-xs">{v.trim}</p>}
                  </div>
                  {v.id === vehicle.id && <CheckCircle2 size={15} className="text-amber-500 shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Interval Edit Modal ─────────────────────────────────────────────── */}
      {editingInterval && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-zinc-100">Edit Interval</h3>
                <p className="text-zinc-500 text-sm mt-0.5">{editingInterval.cat.name}</p>
              </div>
              <button onClick={() => setEditingInterval(null)} className="text-zinc-500 hover:text-zinc-300"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Every (months)</label>
                <input
                  type="number"
                  value={editIntervalMonths}
                  onChange={e => setEditIntervalMonths(e.target.value)}
                  placeholder="e.g. 6"
                  min="0"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">Every (miles)</label>
                <input
                  type="number"
                  value={editIntervalMiles}
                  onChange={e => setEditIntervalMiles(e.target.value)}
                  placeholder="e.g. 5000"
                  min="0"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setEditingInterval(null)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-2.5 transition-colors">Cancel</button>
              <button
                onClick={saveInterval}
                disabled={intervalSaving}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-2.5 transition-colors"
              >
                {intervalSaving ? 'Saving…' : 'Save'}
              </button>
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
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 text-2xl font-bold tabular-nums focus:outline-none focus:border-amber-500/70 transition-all mb-2" autoFocus />
            <p className="text-zinc-600 text-xs mb-4">Current: {vehicle.odometer.toLocaleString()} mi — must be equal or higher</p>
            <div className="flex gap-3">
              <button onClick={() => setShowOdoModal(false)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-2.5 transition-colors">Cancel</button>
              <button onClick={saveOdometer} disabled={odoSaving || !newOdo || parseInt(newOdo) < vehicle.odometer}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-2.5 transition-colors">
                {odoSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add Service Flow ─────────────────────────────────────────────────── */}
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
