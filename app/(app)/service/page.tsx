'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { format, parseISO, subDays, subMonths, subYears, differenceInDays } from 'date-fns'
import {
  Plus, Pencil, Trash2, X, Wrench, Settings, FileText, Upload, Image,
  SlidersHorizontal, Paperclip, ChevronRight, ExternalLink, AlertTriangle,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { withRetry, withTimeout } from '@/lib/recover'
import { getCache, setCache } from '@/lib/cache'
import type { ServiceLog, ServiceCategory, ServiceCategoryProduct } from '@/lib/types'
import dynamic from 'next/dynamic'

const CategoryManagerModal = dynamic(() => import('@/components/service/CategoryManagerModal'), { ssr: false })
const CarfaxImportModal = dynamic(() => import('@/components/service/CarfaxImportModal'), { ssr: false })
const ExportPdfModal = dynamic(() => import('@/components/service/ExportPdfModal'), { ssr: false })
const ImageCropModal = dynamic(() => import('@/components/service/ImageCropModal'), { ssr: false })
const AddServiceFlow = dynamic(() => import('@/components/service/AddServiceFlow'), { ssr: false })
const ReceiptViewer = dynamic(() => import('@/components/ui/ReceiptViewer'), { ssr: false })
const ReceiptPreviewModal = dynamic(() => import('@/components/service/ReceiptPreviewModal'), { ssr: false })

type CostFilter = 'week' | 'month' | '3mo' | '6mo' | 'year' | 'all'
type SortKey = 'date' | 'odometer' | 'cost'
type ActiveTab = 'schedule' | 'history'

interface ServiceGroup {
  key: string
  date: string
  logs: ServiceLog[]
  totalCost: number | null
  isMulti: boolean
}

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

const COST_FILTERS: { key: CostFilter; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: '3mo', label: '3 Mo' },
  { key: '6mo', label: '6 Mo' },
  { key: 'year', label: 'Year' },
]

const FALLBACK_MILES_PER_MONTH = 1250

function calcMilesPerMonth(logs: ServiceLog[]): number {
  const readings = logs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })).sort((a, b) => a.date.localeCompare(b.date))
  if (readings.length < 2) return FALLBACK_MILES_PER_MONTH
  const oldest = readings[0], newest = readings[readings.length - 1]
  const days = differenceInDays(parseISO(newest.date), parseISO(oldest.date))
  if (days < 30 || newest.odo <= oldest.odo) return FALLBACK_MILES_PER_MONTH
  return Math.round((newest.odo - oldest.odo) / days * 30)
}

function projectedOdo(baseOdo: number, logs: ServiceLog[], milesPerMonth: number): number {
  const readings = logs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })).sort((a, b) => b.date.localeCompare(a.date))
  const latest = readings[0]
  if (!latest || milesPerMonth <= 0) return baseOdo
  const daysSince = differenceInDays(new Date(), parseISO(latest.date))
  if (daysSince <= 0) return Math.max(baseOdo, latest.odo)
  return Math.max(baseOdo, latest.odo + Math.round((milesPerMonth / 30) * daysSince))
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

function cutoffDate(filter: CostFilter): Date | null {
  const now = new Date()
  if (filter === 'week') return subDays(now, 7)
  if (filter === 'month') return subMonths(now, 1)
  if (filter === '3mo') return subMonths(now, 3)
  if (filter === '6mo') return subMonths(now, 6)
  if (filter === 'year') return subYears(now, 1)
  return null
}

function groupLogs(logs: ServiceLog[]): ServiceGroup[] {
  const map = new Map<string, ServiceLog[]>()
  for (const log of logs) {
    const key = log.date
    const arr = map.get(key) ?? []
    arr.push(log)
    map.set(key, arr)
  }
  return Array.from(map.entries()).map(([key, items]) => {
    const hasCost = items.some(l => l.cost != null)
    return {
      key,
      date: key,
      logs: items,
      totalCost: hasCost ? items.reduce((s, l) => s + Number(l.cost ?? 0), 0) : null,
      isMulti: items.length > 1,
    }
  })
}

function computeTypeAverages(logs: ServiceLog[], serviceType: string) {
  const sorted = logs.filter(l => l.service_type === serviceType && l.odometer > 0).sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 2) return null
  const milesArr: number[] = [], daysArr: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const mi = sorted[i].odometer - sorted[i - 1].odometer
    const dy = differenceInDays(parseISO(sorted[i].date), parseISO(sorted[i - 1].date))
    if (mi > 0) milesArr.push(mi)
    if (dy > 0) daysArr.push(dy)
  }
  return {
    avgMiles: milesArr.length ? Math.round(milesArr.reduce((a, b) => a + b, 0) / milesArr.length) : null,
    avgDays: daysArr.length ? Math.round(daysArr.reduce((a, b) => a + b, 0) / daysArr.length) : null,
  }
}

const EMPTY_FORM = {
  record_type: 'maintenance' as 'maintenance' | 'repair',
  category_id: '',
  service_type: '',
  performed_by: 'owner' as 'owner' | 'shop',
  shop_name: '',
  shop_location: '',
  date: format(new Date(), 'yyyy-MM-dd'),
  odometer: '',
  cost: '',
  notes: '',
}

export default function ServicePage() {
  const { user } = useAuth()
  const { vehicle } = useVehicle()
  const [logs, setLogs] = useState<ServiceLog[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [products, setProducts] = useState<ServiceCategoryProduct[]>([])
  const [loading, setLoading] = useState(true)
  // True only when a load failed with nothing to show — so we don't render the
  // "no categories" empty state when the truth is "couldn't reach the server".
  const [loadError, setLoadError] = useState(false)

  const [activeTab, setActiveTab] = useState<ActiveTab>('schedule')
  const [selectedStatus, setSelectedStatus] = useState<CategoryWithStatus | null>(null)

  const [showAddFlow, setShowAddFlow] = useState(false)
  const [editLog, setEditLog] = useState<ServiceLog | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [cropSourceFile, setCropSourceFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [showCategoryManager, setShowCategoryManager] = useState(false)
  const [showCarfaxImport, setShowCarfaxImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [addingCategory, setAddingCategory] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<ServiceGroup | null>(null)
  const [receiptPreviewLog, setReceiptPreviewLog] = useState<ServiceLog | null>(null)
  const [deleteExtraOptions, setDeleteExtraOptions] = useState<ServiceLog[] | null>(null)
  const [mergeConflict, setMergeConflict] = useState<{
    dupes: ServiceLog[]
    mergedNotes: string
    conflicts: { field: string; label: string; values: string[]; chosen: string }[]
  } | null>(null)

  const [costFilter, setCostFilter] = useState<CostFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  const cacheFirstFor = useRef<string | null>(null)
  const load = useCallback(async () => {
    if (!vehicle) return
    const key = `service:${vehicle.id}`
    const fetchFresh = async () => {
      const [{ data: logsData }, { data: catsData }, { data: prodsData }] = await withRetry(() => withTimeout(Promise.all([
        supabase.from('service_logs').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }),
        supabase.from('service_categories').select('*').eq('vehicle_id', vehicle.id).order('name'),
        supabase.from('service_category_products').select('*').eq('vehicle_id', vehicle.id),
      ]), 8000))
      const next = {
        logs: logsData ?? [],
        categories: catsData ?? [],
        products: prodsData ?? [],
      }
      setLogs(next.logs)
      setCategories(next.categories)
      setProducts(next.products)
      setCache(key, next)
      setLoadError(false)
    }
    // First view of this vehicle's page (fresh mount / navigation / vehicle switch):
    // if we already have the data cached, show it instantly and quietly re-check in
    // the background. Later calls for the same vehicle (after a write) fetch fresh.
    if (cacheFirstFor.current !== vehicle.id) {
      cacheFirstFor.current = vehicle.id
      const cached = getCache<{ logs: ServiceLog[]; categories: ServiceCategory[]; products: ServiceCategoryProduct[] }>(key)
      if (cached) {
        setLogs(cached.logs)
        setCategories(cached.categories)
        setProducts(cached.products)
        setLoading(false)
        setLoadError(false)
        fetchFresh().catch(() => { /* background re-check; keep showing cached */ })
        return
      }
    }
    // No cache yet, or an explicit reload after a write: fetch and show a spinner.
    setLoading(true)
    try {
      await fetchFresh()
    } catch {
      // Both attempts failed and we have nothing cached — flag it so the UI shows a
      // "couldn't reach the server" retry instead of a misleading empty state.
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [vehicle])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (selectedGroup) {
      const updated = groupLogs(logs).find(g => g.key === selectedGroup.key)
      if (updated) setSelectedGroup(updated)
    }
  }, [logs]) // eslint-disable-line

  // Lock background scroll while a mobile detail sheet is open, so the page
  // behind can't scroll into blank space on touch.
  useEffect(() => {
    if (selectedStatus || selectedGroup) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [selectedStatus, selectedGroup])

  // Mobile detail sheet: swipe down to dismiss.
  const [sheetDragY, setSheetDragY] = useState(0)
  const sheetScrollRef = useRef<HTMLDivElement>(null)
  const sheetTouchStartY = useRef<number | null>(null)
  function onSheetTouchStart(e: React.TouchEvent) { sheetTouchStartY.current = e.touches[0].clientY }
  function onSheetTouchMove(e: React.TouchEvent) {
    if (sheetTouchStartY.current == null) return
    const dy = e.touches[0].clientY - sheetTouchStartY.current
    if (dy > 0 && (sheetScrollRef.current?.scrollTop ?? 0) <= 0) setSheetDragY(dy)
  }
  function onSheetTouchEnd() {
    if (sheetDragY > 110) setSelectedStatus(null)
    setSheetDragY(0)
    sheetTouchStartY.current = null
  }

  function openEdit(log: ServiceLog) {
    setEditLog(log)
    setReceiptFile(null)
    setReceiptPreview(null)
    setForm({
      record_type: (log.record_type as 'maintenance' | 'repair') ?? 'maintenance',
      category_id: log.category_id ?? '',
      service_type: log.service_type,
      performed_by: (log.performed_by as 'owner' | 'shop') ?? 'owner',
      shop_name: log.shop_name ?? '',
      shop_location: log.shop_location ?? '',
      date: log.date,
      odometer: String(log.odometer),
      cost: log.cost != null ? String(log.cost) : '',
      notes: log.notes ?? '',
    })
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type.startsWith('image/')) { setCropSourceFile(file) }
    else { setReceiptFile(file); setReceiptPreview(URL.createObjectURL(file)) }
  }

  function handleCropConfirm(compressed: File) {
    setCropSourceFile(null)
    setReceiptFile(compressed)
    setReceiptPreview(URL.createObjectURL(compressed))
  }

  async function uploadReceipt(file: File, userId: string): Promise<string | null> {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${userId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('receipts').upload(path, file)
    return error ? null : path
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!vehicle || !user || !editLog) return
    setSaving(true)
    const catId = form.record_type === 'maintenance' && form.category_id ? form.category_id : null
    const cat = catId ? categories.find(c => c.id === catId) : null
    const serviceType = form.record_type === 'maintenance' ? (cat?.name ?? form.service_type.trim()) : form.service_type.trim()
    let receiptUrl = editLog.receipt_url ?? null
    if (receiptFile) {
      const path = await uploadReceipt(receiptFile, user.id)
      if (path) { if (receiptUrl) await supabase.storage.from('receipts').remove([receiptUrl]); receiptUrl = path }
    }
    await supabase.from('service_logs').update({
      service_type: serviceType, category_id: catId, record_type: form.record_type,
      performed_by: form.performed_by,
      shop_name: form.performed_by === 'shop' ? (form.shop_name.trim() || null) : null,
      shop_location: form.performed_by === 'shop' ? (form.shop_location.trim() || null) : null,
      receipt_url: receiptUrl, date: form.date, odometer: parseInt(form.odometer),
      cost: form.cost ? parseFloat(form.cost) : null, notes: form.notes.trim() || null,
    }).eq('id', editLog.id)
    await load()
    setEditLog(null)
    setSaving(false)
  }

  async function handleDelete(id: string) {
    const log = logs.find(l => l.id === id)
    // Optimistic removal — instant UI update, no flicker
    const newLogs = logs.filter(l => l.id !== id)
    setLogs(newLogs)
    setDeleteId(null)
    setDeleteExtraOptions(null)
    if (selectedGroup?.logs.some(l => l.id === id)) {
      const remaining = selectedGroup.logs.filter(l => l.id !== id)
      if (remaining.length === 0) {
        setSelectedGroup(null)
      } else {
        const hasCost = remaining.some(l => l.cost != null)
        setSelectedGroup({
          ...selectedGroup,
          logs: remaining,
          totalCost: hasCost ? remaining.reduce((s, l) => s + Number(l.cost ?? 0), 0) : null,
          isMulti: remaining.length > 1,
        })
      }
    }
    // Actual delete (fire and confirm with server)
    if (log?.receipt_url) await supabase.storage.from('receipts').remove([log.receipt_url])
    await supabase.from('service_logs').delete().eq('id', id)
    await load()
  }

  async function repairCategoryLinks() {
    if (!vehicle) return
    const updates = categories
      .filter(cat => logs.some(l => l.service_type === cat.name && l.category_id == null))
      .map(cat =>
        supabase.from('service_logs')
          .update({ category_id: cat.id })
          .eq('vehicle_id', vehicle.id)
          .eq('service_type', cat.name)
          .is('category_id', null)
      )
    await Promise.all(updates)
    await load()
  }

  async function addAsCategory(originalType: string, displayName?: string) {
    if (!vehicle || !user) return
    const finalName = (displayName ?? originalType).trim() || originalType
    setAddingCategory(originalType)
    const subType = /check|inspection/i.test(finalName) ? 'check' : 'service'
    const { data: newCat } = await supabase
      .from('service_categories')
      .insert({ user_id: user.id, vehicle_id: vehicle.id, name: finalName, category_type: 'maintenance', sub_type: subType })
      .select('id')
      .single()
    if (newCat) {
      await supabase
        .from('service_logs')
        .update({ category_id: newCat.id, service_type: finalName })
        .eq('vehicle_id', vehicle.id)
        .eq('service_type', originalType)
    }
    await load()
    setAddingCategory(null)
  }

  // ─── Derived data ────────────────────────────────────────────────────────────
  const milesPerMonth = calcMilesPerMonth(logs)
  const estOdo = vehicle ? projectedOdo(vehicle.odometer, logs, milesPerMonth) : 0

  const maintenanceCats = categories.filter(c => c.category_type === 'maintenance')
  const repairCats = categories.filter(c => c.category_type === 'repair')

  const scheduledMaintCats = maintenanceCats.filter(c => c.interval_miles != null || c.interval_days != null)
  const unscheduledMaintCats = maintenanceCats.filter(c => c.interval_miles == null && c.interval_days == null)

  const scheduledStatuses = scheduledMaintCats.map(c => buildCategoryStatus(c, logs, estOdo))
  const serviceStatuses = scheduledStatuses.filter(s => s.cat.sub_type !== 'check')
  const checkStatuses = scheduledStatuses.filter(s => s.cat.sub_type === 'check')
  const overdueSchedCount = scheduledStatuses.filter(s => s.isOverdue).length
  const onTrackPct = scheduledStatuses.length ? Math.round(((scheduledStatuses.length - overdueSchedCount) / scheduledStatuses.length) * 100) : 100
  const onTrackCircumference = 2 * Math.PI * 25

  // History tab derived data
  const allTypes = Array.from(new Set(logs.map(l => l.service_type))).sort()
  const categoryNames = new Set(categories.map(c => c.name))
  const uncategorizedTypes = allTypes.filter(t => !categoryNames.has(t))
  const cutoff = cutoffDate(costFilter)
  const timeFiltered = cutoff ? logs.filter(l => parseISO(l.date) >= cutoff) : logs
  const filteredCost = timeFiltered.reduce((s, l) => s + Number(l.cost ?? 0), 0)
  const allGroups = groupLogs(timeFiltered)
  const visibleGroups = typeFilter ? allGroups.filter(g => g.logs.some(l => l.service_type === typeFilter)) : allGroups
  const sortedGroups = [...visibleGroups].sort((a, b) => {
    if (sortKey === 'date') return b.date.localeCompare(a.date)
    if (sortKey === 'odometer') return Math.max(...b.logs.map(l => l.odometer)) - Math.max(...a.logs.map(l => l.odometer))
    return (b.totalCost ?? 0) - (a.totalCost ?? 0)
  })
  const activeFilterCount = (costFilter !== 'all' ? 1 : 0) + (typeFilter ? 1 : 0) + (sortKey !== 'date' ? 1 : 0)
  const hasUnlinkedLogs = categories.some(cat => logs.some(l => l.service_type === cat.name && l.category_id == null))
  const typeAvgs = typeFilter ? computeTypeAverages(logs, typeFilter) : null

  // ─── Category detail panel (Schedule tab) ────────────────────────────────────
  function renderCategoryDetail(status: CategoryWithStatus) {
    const { cat, lastLog, lastOdo, lastDate, nextOdo, nextDate, milesLeft, daysLeft, isOverdue, isDueSoon } = status
    const catLogs = logs.filter(l => l.category_id === cat.id).sort((a, b) => b.date.localeCompare(a.date))
    const catProds = products.filter(p => p.category_id === cat.id)
    const catSpent = catLogs.reduce((s, l) => s + Number(l.cost ?? 0), 0)

    const badge = isOverdue
      ? { label: 'Overdue', cls: 'bg-danger/10 text-danger border-danger/25' }
      : isDueSoon
      ? { label: 'Due Soon', cls: 'bg-warn/10 text-warn border-warn/25' }
      : { label: 'Up to Date', cls: 'bg-surface-2 text-muted border-border-strong' }

    const subLabel = cat.sub_type === 'check' ? 'Check' : cat.category_type === 'repair' ? 'Repair' : 'Service'

    const usagePct = (() => {
      if (cat.interval_miles && lastOdo != null) {
        return Math.min(100, Math.max(0, Math.round(((estOdo - lastOdo) / cat.interval_miles) * 100)))
      }
      if (cat.interval_days && lastDate != null) {
        const elapsed = differenceInDays(new Date(), parseISO(lastDate))
        return Math.min(100, Math.max(0, Math.round((elapsed / cat.interval_days) * 100)))
      }
      return null
    })()

    const nextDueLabel = (() => {
      if (nextOdo == null && nextDate == null) return null
      if (isOverdue) {
        if (milesLeft != null && milesLeft < 0) return `${Math.abs(milesLeft).toLocaleString()} mi over`
        if (daysLeft != null && daysLeft < 0) return `${Math.abs(daysLeft)}d overdue`
      }
      if (milesLeft != null && milesLeft > 0) return `${milesLeft.toLocaleString()} mi left`
      if (daysLeft != null && daysLeft > 0) return `${daysLeft}d left`
      return 'Due now'
    })()

    return (
      <div className="space-y-5">
        {(isOverdue || isDueSoon) && (
          <div className={`rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 border ${isOverdue ? 'bg-danger/10 border-danger/25' : 'bg-warn/10 border-warn/25'}`}>
            <div className="flex items-start gap-2.5 flex-1">
              <AlertTriangle size={18} className={`${isOverdue ? 'text-danger' : 'text-warn'} shrink-0 mt-0.5`} />
              <div className="min-w-0">
                <p className={`font-bold ${isOverdue ? 'text-danger' : 'text-warn'}`}>{cat.name} is {isOverdue ? 'overdue' : 'due soon'}</p>
                <p className="text-muted text-sm">{nextDueLabel}{lastDate ? ` · last done ${format(parseISO(lastDate), 'MMM d, yyyy')}` : ''}</p>
              </div>
            </div>
            <button onClick={() => setShowAddFlow(true)} className="bg-accent hover:bg-accent-hover text-accent-foreground font-bold rounded-xl px-4 py-2 text-sm whitespace-nowrap shrink-0 text-center">Log this service</button>
          </div>
        )}
        <div>
          <h3 className="text-xl lg:text-2xl font-bold text-foreground">{cat.name}</h3>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-md font-medium border ${badge.cls}`}>{badge.label}</span>
            <span className="text-xs px-2 py-0.5 rounded-md font-medium bg-surface-2 text-muted border border-border-strong">{subLabel}</span>
            {(cat.interval_miles || cat.interval_days) && (
              <span className="text-xs text-faint">
                every {[cat.interval_miles ? `${cat.interval_miles.toLocaleString()} mi` : null, cat.interval_days ? `${Math.round(cat.interval_days / 30)} mo` : null].filter(Boolean).join(' / ')}
              </span>
            )}
          </div>
          {usagePct != null && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-faint mb-1">
                <span>Usage since last service</span>
                <span>{usagePct}%</span>
              </div>
              <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-border-strong"
                  style={{ width: `${Math.min(100, usagePct)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Two cards */}
        {(cat.interval_miles != null || cat.interval_days != null || lastLog) && (
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-2xl p-3.5 border ${isOverdue ? 'bg-danger/5 border-danger/20' : isDueSoon ? 'bg-warn/5 border-warn/20' : 'bg-surface-2/50 border-border-strong/60'}`}>
              <p className="text-xs font-medium text-muted mb-2">Next Due</p>
              {nextDueLabel != null ? (
                <div className="space-y-1">
                  <p className={`text-sm lg:text-base font-bold ${isOverdue ? 'text-danger' : isDueSoon ? 'text-warn' : 'text-foreground'}`}>{nextDueLabel}</p>
                  {nextOdo != null && <p className="text-muted text-xs">@ {nextOdo.toLocaleString()} mi</p>}
                  {nextDate && <p className="text-faint text-xs">{format(parseISO(nextDate), 'MMM d, yyyy')}</p>}
                </div>
              ) : (
                <p className="text-faint text-sm">No interval set</p>
              )}
            </div>
            <div className="bg-surface-2/50 border border-border-strong/60 rounded-2xl p-3.5">
              <p className="text-xs font-medium text-muted mb-2">Last Service</p>
              {lastLog ? (
                <div className="space-y-1">
                  <p className="text-sm lg:text-base font-bold text-foreground">{format(parseISO(lastDate!), 'MMM d, yyyy')}</p>
                  <p className="text-muted text-xs">{lastOdo!.toLocaleString()} mi</p>
                  <p className="text-faint text-xs">{differenceInDays(new Date(), parseISO(lastDate!))}d ago</p>
                </div>
              ) : (
                <p className="text-faint text-sm">No records yet</p>
              )}
            </div>
          </div>
        )}

        {/* Products */}
        {catProds.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-faint mb-2">Products / Parts</p>
            <div className="space-y-2">
              {catProds.map(p => (
                <div key={p.id} className="flex items-center gap-3 bg-surface-2/40 border border-border rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground text-sm truncate">{p.name}</p>
                    {p.last_price != null && <p className="text-accent text-xs">${Number(p.last_price).toFixed(2)}</p>}
                  </div>
                  {p.product_url && (
                    <a href={p.product_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent shrink-0">
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Past records — visually separated section */}
        {catLogs.length > 0 && (
          <div className="border-t border-border pt-5 mt-1">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-foreground">Service History <span className="text-faint font-normal">({catLogs.length})</span></h4>
              {catSpent > 0 && <span className="text-xs text-muted">Total spent · <span className="text-accent font-semibold">${catSpent.toFixed(0)}</span></span>}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {catLogs.map(log => (
                <div key={log.id} className="flex items-center gap-2 bg-surface-2/30 border border-border rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground text-sm">{format(parseISO(log.date), 'MMM d, yyyy')}</p>
                    <p className="text-muted text-xs truncate">{log.odometer.toLocaleString()} mi{log.shop_name ? ` · ${log.shop_name}` : ''}{log.notes ? ` · ${log.notes}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {log.cost != null && <span className="text-accent text-sm font-semibold">${Number(log.cost).toFixed(0)}</span>}
                    <button onClick={() => openEdit(log)} className="w-6 h-6 rounded-lg bg-surface-2 hover:bg-surface-2 flex items-center justify-center text-muted hover:text-foreground transition-colors"><Pencil size={11} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Category row (Schedule tab left panel) ──────────────────────────────────
  function renderCategoryRow(status: CategoryWithStatus) {
    const { cat, isOverdue, isDueSoon, milesLeft, daysLeft, lastOdo, lastDate } = status
    const isSelected = selectedStatus?.cat.id === cat.id
    const statusText = isOverdue
      ? (milesLeft != null ? `${Math.abs(milesLeft).toLocaleString()} mi over` : 'Overdue')
      : isDueSoon
      ? (milesLeft != null ? `${milesLeft.toLocaleString()} mi left` : `${daysLeft}d left`)
      : (milesLeft != null ? `${milesLeft.toLocaleString()} mi left` : daysLeft != null ? `${daysLeft}d left` : 'Up to date')
    const textColor = isOverdue ? 'text-danger' : isDueSoon ? 'text-warn' : 'text-muted'

    const pct = (() => {
      if (cat.interval_miles && lastOdo != null) return Math.min(100, Math.max(4, Math.round(((estOdo - lastOdo) / cat.interval_miles) * 100)))
      if (cat.interval_days && lastDate != null) return Math.min(100, Math.max(4, Math.round((differenceInDays(new Date(), parseISO(lastDate)) / cat.interval_days) * 100)))
      return isOverdue ? 100 : isDueSoon ? 85 : 30
    })()
    // Bars are a calm uniform neutral — only the "mi over / left" text carries
    // the urgency color, so the list reads quiet at a glance.
    const barColor = 'bg-border-strong'

    return (
      <button
        key={cat.id}
        onClick={() => setSelectedStatus(isSelected ? null : status)}
        className={`w-full px-4 py-3 border-b border-border/60 text-left transition-colors ${
          isSelected ? 'bg-surface-2/80 lg:border-l-2 lg:border-l-accent' : 'hover:bg-surface-2/40'
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className={`text-sm font-medium truncate ${isSelected ? 'text-accent' : 'text-foreground'}`}>{cat.name}</span>
          <span className={`text-xs font-semibold shrink-0 ${textColor}`}>{statusText}</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
      </button>
    )
  }

  // ─── History group detail ─────────────────────────────────────────────────────
  function handleMergeDuplicates(dupes: ServiceLog[]) {
    // Merge all unique non-empty notes
    const uniqueNotes = Array.from(new Set(dupes.map(l => l.notes?.trim()).filter(Boolean)))
    const mergedNotes = uniqueNotes.join('\n\n---\n\n')

    // Detect field conflicts
    const conflicts: { field: string; label: string; values: string[]; chosen: string }[] = []
    const odos = Array.from(new Set(dupes.map(l => String(l.odometer))))
    if (odos.length > 1) conflicts.push({ field: 'odometer', label: 'Odometer (mi)', values: odos, chosen: odos[0] })
    const shops = Array.from(new Set(dupes.map(l => l.shop_name ?? '').filter(Boolean)))
    if (shops.length > 1) conflicts.push({ field: 'shop_name', label: 'Shop Name', values: shops, chosen: shops[0] })
    const costs = Array.from(new Set(dupes.map(l => l.cost != null ? String(l.cost) : '').filter(Boolean)))
    if (costs.length > 1) conflicts.push({ field: 'cost', label: 'Cost ($)', values: costs, chosen: costs[0] })

    if (conflicts.length > 0) {
      setMergeConflict({ dupes, mergedNotes, conflicts })
    } else {
      executeMerge(dupes, mergedNotes, {})
    }
  }

  async function executeMerge(dupes: ServiceLog[], mergedNotes: string, overrides: Record<string, string>) {
    const scored = dupes.map(l => ({
      log: l,
      score: (l.cost != null ? 2 : 0) + (l.notes ? 1 : 0) + (l.receipt_url ? 3 : 0),
    }))
    scored.sort((a, b) => b.score - a.score)
    const winner = scored[0].log
    const toDelete = scored.slice(1).map(s => s.log)
    const toDeleteIds = toDelete.map(l => l.id)

    // Optimistic: remove duplicates from local state immediately
    setLogs(prev => prev.filter(l => !toDeleteIds.includes(l.id)))
    setMergeConflict(null)

    const update: Record<string, string | number | null> = { notes: mergedNotes || null }
    if (overrides.odometer) update.odometer = parseInt(overrides.odometer)
    if (overrides.shop_name !== undefined) update.shop_name = overrides.shop_name || null
    if (overrides.cost) update.cost = parseFloat(overrides.cost)

    await supabase.from('service_logs').update(update).eq('id', winner.id)
    for (const log of toDelete) {
      if (log.receipt_url) await supabase.storage.from('receipts').remove([log.receipt_url])
      await supabase.from('service_logs').delete().eq('id', log.id)
    }
    await load()
  }

  function renderGroupDetail(group: ServiceGroup) {
    const maxOdo = Math.max(...group.logs.map(l => l.odometer))

    const typeMap = new Map<string, ServiceLog[]>()
    for (const log of group.logs) {
      const arr = typeMap.get(log.service_type) ?? []
      arr.push(log)
      typeMap.set(log.service_type, arr)
    }
    const duplicateGroups = Array.from(typeMap.values()).filter(arr => arr.length > 1)

    return (
      <div className="space-y-5">
        <div>
          <h3 className="text-xl font-bold text-foreground">{format(parseISO(group.date), 'MMMM d, yyyy')}</h3>
          <p className="text-muted text-sm mt-1">
            {maxOdo.toLocaleString()} mi
            {group.logs.find(l => l.shop_name) ? ` · ${group.logs.find(l => l.shop_name)!.shop_name}` : ''}
          </p>
          {group.totalCost != null && <p className="text-accent font-bold mt-1">Total: ${group.totalCost.toFixed(2)}</p>}
        </div>

        {duplicateGroups.length > 0 && (
          <div className="bg-accent/5 border border-accent/20 rounded-2xl px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={13} className="text-accent" />
              <p className="text-accent text-xs font-semibold">Duplicate services on this day</p>
            </div>
            {duplicateGroups.map(dupes => (
              <div key={dupes[0].service_type} className="flex items-center justify-between gap-2">
                <p className="text-accent text-xs truncate flex-1">{dupes[0].service_type} ({dupes.length}×)</p>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleMergeDuplicates(dupes)} className="text-xs px-2 py-1 bg-accent/15 text-accent hover:bg-accent-hover/25 rounded-lg transition-colors">Merge</button>
                  <button onClick={() => setDeleteExtraOptions(dupes)} className="text-xs px-2 py-1 bg-danger/10 text-danger hover:bg-danger/20 rounded-lg transition-colors">Delete extra</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          {group.logs.map(log => {
            const isOwner = log.performed_by === 'owner'
            return (
              <div key={log.id} className={`border rounded-2xl overflow-hidden ${isOwner ? 'bg-accent/10 border-accent/25' : 'bg-surface-2/40 border-border'}`}>
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-foreground font-semibold text-sm">{log.service_type}</p>
                        {log.record_type === 'repair' && <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-warn/10 text-warn">Repair</span>}
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-surface-2 text-muted">{isOwner ? '🔧 DIY' : '🏪 Shop'}</span>
                        {!log.category_id && <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-warn/10 text-warn">No category</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <p className="text-muted text-xs">{log.odometer.toLocaleString()} mi</p>
                        {log.cost != null && <span className="text-accent font-bold text-sm">${Number(log.cost).toFixed(2)}</span>}
                        {log.shop_name && <p className="text-faint text-xs">{log.shop_name}</p>}
                      </div>
                      {log.notes && <p className="text-faint text-xs mt-1 line-clamp-2">{log.notes}</p>}
                      {!log.category_id && (
                        <button
                          onClick={() => addAsCategory(log.service_type)}
                          disabled={addingCategory === log.service_type}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent bg-accent/10 hover:bg-accent/20 border border-accent/25 rounded-lg px-2 py-1 transition-colors disabled:opacity-50"
                        >
                          <Plus size={11} /> {addingCategory === log.service_type ? 'Adding…' : `Track “${log.service_type}” as category`}
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {log.receipt_url && (
                        <button onClick={() => setReceiptPreviewLog(log)} className="w-7 h-7 rounded-lg bg-surface-2/60 flex items-center justify-center text-accent/70 hover:text-accent transition-colors" title="View Receipt"><Paperclip size={12} /></button>
                      )}
                      <button onClick={() => openEdit(log)} className="w-7 h-7 rounded-lg bg-surface-2/60 flex items-center justify-center text-muted hover:text-foreground transition-colors"><Pencil size={12} /></button>
                      <button onClick={() => setDeleteId(log.id)} className="w-7 h-7 rounded-lg bg-surface-2/60 flex items-center justify-center text-muted hover:text-danger transition-colors"><Trash2 size={12} /></button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background min-h-screen lg:min-h-0 lg:h-[calc(100vh-4rem)] lg:flex lg:flex-col lg:overflow-hidden">

      {/* ─── Header ─────────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-12 pb-3 lg:pt-3 lg:shrink-0 lg:border-b lg:border-border">
        <div className="flex items-center justify-between">
          <h1 className="text-xl lg:text-lg font-bold text-foreground">Service Center</h1>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowExport(true)} className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-muted hover:text-foreground transition-colors" title="Export PDF"><FileText size={16} /></button>
            <button onClick={() => setShowCarfaxImport(true)} className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-muted hover:text-foreground transition-colors" title="Import Carfax"><Upload size={16} /></button>
            <button onClick={() => setShowCategoryManager(true)} className="w-9 h-9 rounded-xl bg-surface border border-border flex items-center justify-center text-muted hover:text-foreground transition-colors" title="Manage Categories"><Settings size={16} /></button>
            <button onClick={() => setShowAddFlow(true)} className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl px-4 py-2 text-sm transition-colors shadow-lg shadow-accent/20">
              <Plus size={15} /> Add
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="mt-3 flex gap-1 bg-surface border border-border rounded-2xl p-1">
          <button
            onClick={() => setActiveTab('schedule')}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${activeTab === 'schedule' ? 'bg-surface-2 text-foreground' : 'text-muted hover:text-foreground'}`}
          >
            Schedule
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-colors ${activeTab === 'history' ? 'bg-surface-2 text-foreground' : 'text-muted hover:text-foreground'}`}
          >
            History
          </button>
        </div>
      </div>

      {/* ─── Schedule Tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'schedule' && (
        <div className="lg:flex lg:flex-1 lg:overflow-hidden">

          {/* Left: category list */}
          <div className="lg:w-80 xl:w-96 lg:border-r lg:border-border lg:overflow-y-auto lg:flex-shrink-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : loadError && categories.length === 0 ? (
              <div className="text-center py-16 px-4">
                <AlertTriangle size={36} className="text-faint mx-auto mb-3" />
                <p className="text-muted font-medium">Couldn’t reach the server</p>
                <p className="text-faint text-sm mt-1">Your data is safe — the connection just needs a moment.</p>
                <button onClick={() => load()} className="mt-4 text-accent text-sm font-medium hover:text-accent transition-colors">Try again →</button>
              </div>
            ) : categories.length === 0 ? (
              <div className="text-center py-16 px-4">
                <Settings size={36} className="text-faint mx-auto mb-3" />
                <p className="text-muted font-medium">No categories yet</p>
                <p className="text-faint text-sm mt-1">Set up maintenance categories to track your schedule</p>
                <button onClick={() => setShowCategoryManager(true)} className="mt-4 text-accent text-sm font-medium hover:text-accent transition-colors">Manage Categories →</button>
              </div>
            ) : (
              <div className="pb-8">
                {vehicle && (
                  <div className="p-4 border-b border-border">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-bold text-foreground truncate">{vehicle.make} {vehicle.model}</p>
                        <p className="text-muted text-sm">{vehicle.year}{vehicle.trim ? ` · ${vehicle.trim}` : ''}</p>
                        <p className="text-foreground font-semibold mt-0.5 tabular-nums text-sm">{estOdo.toLocaleString()} mi</p>
                      </div>
                      <div className="flex flex-col items-center shrink-0">
                        <div className="relative w-[60px] h-[60px]">
                          <svg width="60" height="60" viewBox="0 0 60 60">
                            <circle cx="30" cy="30" r="25" fill="none" stroke="#27272b" strokeWidth="5" />
                            <circle cx="30" cy="30" r="25" fill="none" stroke="#3b82f6" strokeWidth="5" strokeLinecap="round" strokeDasharray={onTrackCircumference} strokeDashoffset={onTrackCircumference * (1 - onTrackPct / 100)} transform="rotate(-90 30 30)" />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center"><span className="text-foreground font-bold text-sm">{onTrackPct}%</span></div>
                        </div>
                        <span className="text-faint text-[10px] mt-1">On schedule</span>
                      </div>
                    </div>
                  </div>
                )}
                {serviceStatuses.length > 0 && (
                  <div>
                    <p className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-faint">Service</p>
                    {serviceStatuses.map(s => renderCategoryRow(s))}
                  </div>
                )}
                {checkStatuses.length > 0 && (
                  <div>
                    <p className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-faint">Checks</p>
                    {checkStatuses.map(s => renderCategoryRow(s))}
                  </div>
                )}
                {unscheduledMaintCats.length > 0 && (
                  <div>
                    <p className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-faint">No Schedule</p>
                    {unscheduledMaintCats.map(cat => {
                      const isSelected = selectedStatus?.cat.id === cat.id
                      const s = buildCategoryStatus(cat, logs, estOdo)
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedStatus(isSelected ? null : s)}
                          className={`w-full flex items-center gap-3 px-4 py-3 border-b border-border/60 text-left transition-colors ${isSelected ? 'bg-surface-2/80 lg:border-l-2 lg:border-l-accent' : 'hover:bg-surface-2/40'}`}
                        >
                          <div className="w-2 h-2 rounded-full bg-faint shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isSelected ? 'text-accent' : 'text-muted'}`}>{cat.name}</p>
                            <p className="text-faint text-xs mt-0.5">No interval set</p>
                          </div>
                          {isSelected && <ChevronRight size={13} className="text-accent shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                )}
                {repairCats.length > 0 && (
                  <div>
                    <p className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-widest text-faint">Repair</p>
                    {repairCats.map(cat => {
                      const isSelected = selectedStatus?.cat.id === cat.id
                      const s = buildCategoryStatus(cat, logs, estOdo)
                      const lastLog = logs.filter(l => l.category_id === cat.id).sort((a, b) => b.date.localeCompare(a.date))[0]
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedStatus(isSelected ? null : s)}
                          className={`w-full flex items-center gap-3 px-4 py-3 border-b border-border/60 text-left transition-colors ${isSelected ? 'bg-surface-2/80 lg:border-l-2 lg:border-l-accent' : 'hover:bg-surface-2/40'}`}
                        >
                          <div className="w-2 h-2 rounded-full bg-warn/70 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${isSelected ? 'text-accent' : 'text-foreground'}`}>{cat.name}</p>
                            <p className="text-muted text-xs mt-0.5">{lastLog ? `Last: ${format(parseISO(lastLog.date), 'MMM d, yyyy')}` : 'No records'}</p>
                          </div>
                          {isSelected && <ChevronRight size={13} className="text-accent shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: detail panel (desktop) */}
          <div className="hidden lg:flex lg:flex-1 lg:overflow-y-auto lg:flex-col">
            {selectedStatus ? (
              <div className="p-6 lg:p-8 pb-10 w-full max-w-5xl">
                {renderCategoryDetail(selectedStatus)}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Wrench size={40} className="text-border-strong mx-auto mb-3" />
                  <p className="text-faint font-medium">Select a category</p>
                  <p className="text-faint text-sm mt-1">to see its schedule, products, and history</p>
                </div>
              </div>
            )}
          </div>

          {/* Mobile: bottom sheet */}
          {selectedStatus && (
            <div className="lg:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end" onClick={() => setSelectedStatus(null)}>
              <div
                ref={sheetScrollRef}
                className="w-full bg-surface border-t border-border rounded-t-3xl max-h-[90vh] overflow-y-auto overscroll-contain"
                onClick={e => e.stopPropagation()}
                onTouchStart={onSheetTouchStart}
                onTouchMove={onSheetTouchMove}
                onTouchEnd={onSheetTouchEnd}
                style={{ transform: sheetDragY ? `translateY(${sheetDragY}px)` : undefined, transition: sheetDragY ? 'none' : 'transform 0.25s ease' }}
              >
                <div className="sticky top-0 bg-surface/95 backdrop-blur-sm pt-3 pb-3 px-6 border-b border-border/60">
                  <div className="w-12 h-1.5 bg-border-strong rounded-full mx-auto mb-1" />
                  <p className="text-faint text-[11px] text-center">swipe down or tap outside to close</p>
                </div>
                <div className="px-6 py-5 pb-10">
                  {renderCategoryDetail(selectedStatus)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── History Tab ─────────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="lg:flex lg:flex-1 lg:overflow-hidden">

          {/* Left: list */}
          <div className="lg:w-80 xl:w-96 lg:border-r lg:border-border lg:overflow-y-auto lg:flex-shrink-0">
            {/* Filter row */}
            <div className="px-4 pt-3 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowFilterModal(true)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors border ${activeFilterCount > 0 ? 'bg-accent/10 text-accent border-accent/30' : 'bg-surface text-muted border-border'}`}
                >
                  <SlidersHorizontal size={15} /> Filters
                  {activeFilterCount > 0 && <span className="bg-accent text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>}
                </button>
                {typeFilter && (
                  <div className="flex items-center gap-1.5 bg-accent/10 border border-accent/20 rounded-xl px-3 py-2">
                    <span className="text-accent text-sm font-medium truncate max-w-[140px]">{typeFilter}</span>
                    <button onClick={() => setTypeFilter(null)} className="text-accent hover:text-accent shrink-0"><X size={13} /></button>
                  </div>
                )}
                {costFilter !== 'all' && (
                  <div className="flex items-center gap-1.5 bg-surface-2 border border-border-strong rounded-xl px-3 py-2">
                    <span className="text-foreground text-sm font-medium">{COST_FILTERS.find(f => f.key === costFilter)?.label}</span>
                    <button onClick={() => setCostFilter('all')} className="text-muted hover:text-foreground"><X size={13} /></button>
                  </div>
                )}
                {sortKey !== 'date' && (
                  <div className="flex items-center gap-1.5 bg-surface-2 border border-border-strong rounded-xl px-3 py-2">
                    <span className="text-foreground text-sm font-medium capitalize">↕ {sortKey}</span>
                    <button onClick={() => setSortKey('date')} className="text-muted hover:text-foreground"><X size={13} /></button>
                  </div>
                )}
              </div>
            </div>

            {/* Banners */}
            <div className="px-4 space-y-2 pb-2">
              {typeFilter && typeAvgs && (typeAvgs.avgMiles || typeAvgs.avgDays) && (
                <div className="bg-surface-2/60 border border-border-strong/50 rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
                  <span className="text-muted text-xs">Avg: <span className="text-foreground font-semibold">{typeFilter}</span></span>
                  {typeAvgs.avgMiles && <span className="text-accent text-xs font-bold">{typeAvgs.avgMiles.toLocaleString()} mi</span>}
                  {typeAvgs.avgDays && <span className="text-muted text-xs">· {Math.round(typeAvgs.avgDays / 30)} mo</span>}
                </div>
              )}
              {hasUnlinkedLogs && (
                <div className="bg-accent/5 border border-accent/20 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                  <p className="text-accent text-xs font-medium">Service records aren&apos;t linked to their categories yet.</p>
                  <button onClick={repairCategoryLinks} className="text-accent text-xs font-bold hover:text-accent transition-colors shrink-0 whitespace-nowrap">Fix Now →</button>
                </div>
              )}
              {logs.length > 0 && (
                <div className="flex gap-2 pb-1">
                  <div className="flex-1 bg-surface border border-border rounded-xl p-2.5 text-center">
                    <p className="text-sm font-bold text-foreground">{timeFiltered.length}</p>
                    <p className="text-xs text-muted">Records</p>
                  </div>
                  <div className="flex-1 bg-surface border border-border rounded-xl p-2.5 text-center">
                    <p className="text-sm font-bold text-accent">${filteredCost.toFixed(0)}</p>
                    <p className="text-xs text-muted">Spend</p>
                  </div>
                </div>
              )}
            </div>

            {/* List */}
            <div className="lg:pb-8 pb-2">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {!loading && sortedGroups.length === 0 && (
                <div className="text-center py-16 px-4">
                  <Wrench size={40} className="text-faint mx-auto mb-3" />
                  <p className="text-muted font-medium">No service records yet</p>
                  <p className="text-faint text-sm mt-1">Tap + Add or Import from Carfax</p>
                </div>
              )}
              {sortedGroups.map(group => {
                const maxOdo = Math.max(...group.logs.map(l => l.odometer))
                const hasReceipt = group.logs.some(l => l.receipt_url)
                const isSelected = selectedGroup?.key === group.key
                const serviceNames = Array.from(new Set(group.logs.map(l => l.service_type)))
                const visibleNames = serviceNames.slice(0, 3)
                const extraCount = serviceNames.length - visibleNames.length
                const typeCount = new Map<string, number>()
                for (const log of group.logs) typeCount.set(log.service_type, (typeCount.get(log.service_type) ?? 0) + 1)
                const hasDups = Array.from(typeCount.values()).some(v => v > 1)
                const hasUncat = group.logs.some(l => !l.category_id)
                return (
                  <button
                    key={group.key}
                    onClick={() => setSelectedGroup(isSelected ? null : group)}
                    className={`w-full px-4 py-3 border-b border-border/60 text-left transition-colors ${
                      isSelected ? 'bg-surface-2/80 lg:border-l-2 lg:border-l-accent' : 'hover:bg-surface-2/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {hasDups && <AlertTriangle size={11} className="text-accent/80 shrink-0" />}
                        {hasUncat && <span className="w-2 h-2 rounded-full bg-warn shrink-0" title="Some services have no category" />}
                        <p className={`text-sm font-semibold truncate ${isSelected ? 'text-accent' : 'text-foreground'}`}>
                          {format(parseISO(group.date), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {hasReceipt && <Paperclip size={10} className="text-accent/60" />}
                        <span className="text-muted text-xs font-medium">{maxOdo.toLocaleString()} mi</span>
                      </div>
                    </div>
                    <div className="mt-0.5 space-y-0">
                      {visibleNames.map(name => (
                        <p key={name} className="text-muted text-xs truncate leading-5">{name}</p>
                      ))}
                      {extraCount > 0 && <p className="text-faint text-xs">+{extraCount} more</p>}
                    </div>
                    {group.totalCost != null && (
                      <p className="text-accent text-xs font-semibold mt-1">${group.totalCost.toFixed(0)}</p>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Mobile bottom sheet */}
            {selectedGroup && (
              <div className="lg:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end" onClick={() => setSelectedGroup(null)}>
                <div className="w-full bg-surface border-t border-border rounded-t-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="sticky top-0 bg-surface/95 backdrop-blur-sm pt-4 pb-3 px-6 border-b border-border/60">
                    <div className="w-12 h-1 bg-surface-2 rounded-full mx-auto mb-3" />
                  </div>
                  <div className="px-6 py-5 pb-10">
                    {renderGroupDetail(selectedGroup)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: detail panel */}
          <div className="hidden lg:flex lg:flex-1 lg:overflow-y-auto lg:flex-col">
            {selectedGroup ? (
              <div className="p-6 pb-10">{renderGroupDetail(selectedGroup)}</div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Wrench size={40} className="text-border-strong mx-auto mb-3" />
                  <p className="text-faint font-medium">Select a service record</p>
                  <p className="text-faint text-sm mt-1">to view details, receipts, and edit options</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Filter Modal ── */}
      {showFilterModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-foreground text-lg">Filter & Sort</h3>
              <button onClick={() => setShowFilterModal(false)} className="text-muted hover:text-foreground"><X size={20} /></button>
            </div>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Time Range</label>
                <div className="flex flex-wrap gap-2">
                  {COST_FILTERS.map(f => (
                    <button key={f.key} onClick={() => setCostFilter(f.key)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${costFilter === f.key ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Sort By</label>
                <div className="flex gap-2">
                  {(['date', 'odometer', 'cost'] as SortKey[]).map(k => (
                    <button key={k} onClick={() => setSortKey(k)}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium capitalize transition-colors border ${sortKey === k ? 'bg-accent/10 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong'}`}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              {allTypes.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-muted mb-2">Service Type</label>
                  <select value={typeFilter ?? ''} onChange={e => setTypeFilter(e.target.value || null)}
                    className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent/70 transition-all appearance-none">
                    <option value="">All Types</option>
                    {allTypes.map(t => <option key={t} value={t}>{t}{!categoryNames.has(t) ? ' (uncategorized)' : ''}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setCostFilter('all'); setSortKey('date'); setTypeFilter(null); setShowFilterModal(false) }}
                className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Reset All</button>
              <button onClick={() => setShowFilterModal(false)}
                className="flex-1 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl py-3 transition-colors">Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editLog && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-foreground text-lg">Edit Service</h3>
              <button onClick={() => setEditLog(null)} className="text-muted hover:text-foreground"><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Type</label>
                <div className="flex gap-2">
                  {(['maintenance', 'repair'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setForm(f => ({ ...f, record_type: t, category_id: '', service_type: '' }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${form.record_type === t ? t === 'maintenance' ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-warn/20 text-warn border border-warn/40' : 'bg-surface-2 text-muted border border-border-strong'}`}>{t}</button>
                  ))}
                </div>
              </div>
              {form.record_type === 'maintenance' ? (
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Category</label>
                  <select value={form.category_id} onChange={e => { const cat = categories.find(c => c.id === e.target.value); setForm(f => ({ ...f, category_id: e.target.value, service_type: cat?.name ?? '' })) }} required
                    className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent/70 transition-all appearance-none">
                    <option value="">Select category…</option>
                    {maintenanceCats.some(c => c.sub_type !== 'check') && (
                      <optgroup label="Service">
                        {maintenanceCats.filter(c => c.sub_type !== 'check').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </optgroup>
                    )}
                    {maintenanceCats.some(c => c.sub_type === 'check') && (
                      <optgroup label="Checks">
                        {maintenanceCats.filter(c => c.sub_type === 'check').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Repair Description</label>
                  <input type="text" placeholder="e.g. Replaced front struts" value={form.service_type} onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))} required
                    className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required
                    className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-3 text-foreground focus:outline-none focus:border-accent/70 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Odometer (mi)</label>
                  <input type="number" placeholder="24500" value={form.odometer} onChange={e => setForm(f => ({ ...f, odometer: e.target.value }))} required min="0"
                    className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Cost ($)</label>
                <input type="number" placeholder="0.00" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} min="0" step="0.01"
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-2">Performed by</label>
                <div className="flex gap-2">
                  {(['owner', 'shop'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setForm(f => ({ ...f, performed_by: t }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${form.performed_by === t ? t === 'owner' ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-success/20 text-success border border-success/40' : 'bg-surface-2 text-muted border border-border-strong'}`}>{t === 'owner' ? '🔧 DIY' : '🏪 Shop'}</button>
                  ))}
                </div>
              </div>
              {form.performed_by === 'shop' && (
                <div className="space-y-3">
                  <input type="text" placeholder="Shop name" value={form.shop_name} onChange={e => setForm(f => ({ ...f, shop_name: e.target.value }))}
                    className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                  <input type="text" placeholder="Location (optional)" value={form.shop_location} onChange={e => setForm(f => ({ ...f, shop_location: e.target.value }))}
                    className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Notes (optional)</label>
                <textarea placeholder="Parts used, observations, etc." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Receipt (optional)</label>
                {receiptPreview && (
                  <div className="relative mb-2">
                    {receiptFile?.type === 'application/pdf' ? (
                      <iframe src={receiptPreview} title="PDF preview" className="w-full h-40 rounded-xl bg-surface-2 border-0" />
                    ) : (
                      <img src={receiptPreview} alt="Receipt preview" className="w-full rounded-xl max-h-40 object-contain bg-surface-2" />
                    )}
                    <button type="button" onClick={() => { setReceiptFile(null); setReceiptPreview(null); if (fileRef.current) fileRef.current.value = '' }}
                      className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"><X size={12} /></button>
                  </div>
                )}
                {editLog.receipt_url && !receiptFile && (
                  <div className="mb-2">
                    <p className="text-xs text-accent/70 mb-1.5">📎 Current receipt — upload new to replace</p>
                    <ReceiptViewer path={editLog.receipt_url} className="min-h-32 max-h-48" />
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleFileChange} className="hidden" />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 w-full border-2 border-dashed border-border-strong hover:border-accent/40 rounded-xl px-4 py-2.5 text-muted hover:text-accent text-sm transition-colors">
                  <Image size={14} />{receiptFile ? 'Change Receipt' : 'Attach Receipt (JPG, PNG, PDF)'}
                </button>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditLog(null)} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors">{saving ? 'Saving…' : 'Update'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-xs text-center">
            <p className="font-bold text-foreground mb-2">Delete this record?</p>
            <p className="text-muted text-sm mb-6">Receipt (if any) will also be removed. This can&apos;t be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 bg-danger hover:bg-danger text-white font-bold rounded-2xl py-3 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {showCategoryManager && vehicle && <CategoryManagerModal vehicle={vehicle} onClose={() => setShowCategoryManager(false)} onUpdated={load} />}
      {showCarfaxImport && vehicle && <CarfaxImportModal vehicle={vehicle} categories={categories} onClose={() => setShowCarfaxImport(false)} onImported={load} />}
      {showExport && vehicle && <ExportPdfModal vehicle={vehicle} logs={logs} onClose={() => setShowExport(false)} />}
      {cropSourceFile && <ImageCropModal file={cropSourceFile} onConfirm={handleCropConfirm} onCancel={() => { setCropSourceFile(null); if (fileRef.current) fileRef.current.value = '' }} />}
      {showAddFlow && vehicle && (
        <AddServiceFlow
          vehicle={vehicle}
          categories={categories}
          historicalReadings={logs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer }))}
          onClose={() => setShowAddFlow(false)}
          onSaved={() => { setShowAddFlow(false); load() }}
        />
      )}

      {/* ── Receipt full-page preview ── */}
      {receiptPreviewLog && (
        <ReceiptPreviewModal
          log={receiptPreviewLog}
          onClose={() => setReceiptPreviewLog(null)}
          onEdit={log => { setReceiptPreviewLog(null); openEdit(log) }}
        />
      )}

      {/* ── Delete extra selection ── */}
      {deleteExtraOptions && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">Which one to delete?</h3>
              <button onClick={() => setDeleteExtraOptions(null)} className="text-muted hover:text-foreground"><X size={18} /></button>
            </div>
            <p className="text-muted text-sm mb-4">Select the record you want to remove.</p>
            <div className="space-y-2">
              {deleteExtraOptions.map(log => (
                <button
                  key={log.id}
                  onClick={() => { setDeleteExtraOptions(null); setDeleteId(log.id) }}
                  className="w-full flex items-start gap-3 bg-surface-2 hover:bg-danger/10 border border-border-strong hover:border-danger/30 rounded-2xl px-4 py-3 text-left transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-foreground text-sm font-medium truncate">{log.service_type}</p>
                    <p className="text-muted text-xs mt-0.5">
                      {format(parseISO(log.date), 'MMM d, yyyy')} · {log.odometer.toLocaleString()} mi
                      {log.cost != null ? ` · $${Number(log.cost).toFixed(0)}` : ''}
                    </p>
                    {log.notes && <p className="text-faint text-xs mt-0.5 line-clamp-1">{log.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    {log.receipt_url && <Paperclip size={11} className="text-accent/60" />}
                    <Trash2 size={14} className="text-danger/70" />
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setDeleteExtraOptions(null)} className="w-full mt-4 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-2.5 text-sm transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Merge conflict resolution ── */}
      {mergeConflict && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-foreground">Resolve conflicts</h3>
              <button onClick={() => setMergeConflict(null)} className="text-muted hover:text-foreground"><X size={18} /></button>
            </div>
            <p className="text-muted text-sm mb-5">The records have conflicting values. Pick which to keep for each:</p>
            <div className="space-y-4">
              {mergeConflict.conflicts.map((c, ci) => (
                <div key={c.field}>
                  <p className="text-xs font-semibold text-muted mb-2">{c.label}</p>
                  <div className="flex gap-2 flex-wrap">
                    {c.values.map(v => (
                      <button
                        key={v}
                        onClick={() => setMergeConflict(prev => {
                          if (!prev) return prev
                          const conflicts = [...prev.conflicts]
                          conflicts[ci] = { ...conflicts[ci], chosen: v }
                          return { ...prev, conflicts }
                        })}
                        className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                          c.chosen === v ? 'bg-accent/15 text-accent border-accent/40' : 'bg-surface-2 text-muted border-border-strong hover:border-border-strong'
                        }`}
                      >{v}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {mergeConflict.mergedNotes && (
              <div className="mt-4 bg-surface-2/60 border border-border-strong rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-muted mb-1">Merged Notes</p>
                <p className="text-foreground text-xs">{mergeConflict.mergedNotes}</p>
              </div>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setMergeConflict(null)} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button
                onClick={() => {
                  const overrides: Record<string, string> = {}
                  for (const c of mergeConflict.conflicts) overrides[c.field] = c.chosen
                  executeMerge(mergeConflict.dupes, mergeConflict.mergedNotes, overrides)
                }}
                className="flex-1 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl py-3 transition-colors"
              >Merge</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
