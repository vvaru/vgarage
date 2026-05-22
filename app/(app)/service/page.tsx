'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { format, parseISO, subDays, subMonths, subYears, differenceInDays } from 'date-fns'
import {
  Plus, Pencil, Trash2, X, Wrench, Settings, FileText, Upload, Image,
  SlidersHorizontal, Paperclip, Check,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import type { ServiceLog, ServiceCategory } from '@/lib/types'
import dynamic from 'next/dynamic'

const CategoryManagerModal = dynamic(() => import('@/components/service/CategoryManagerModal'), { ssr: false })
const CarfaxImportModal = dynamic(() => import('@/components/service/CarfaxImportModal'), { ssr: false })
const ExportPdfModal = dynamic(() => import('@/components/service/ExportPdfModal'), { ssr: false })
const ImageCropModal = dynamic(() => import('@/components/service/ImageCropModal'), { ssr: false })
const AddServiceFlow = dynamic(() => import('@/components/service/AddServiceFlow'), { ssr: false })
const ReceiptViewer = dynamic(() => import('@/components/ui/ReceiptViewer'), { ssr: false })

type CostFilter = 'week' | 'month' | '3mo' | '6mo' | 'year' | 'all'
type SortKey = 'date' | 'odometer' | 'cost'

interface ServiceGroup {
  key: string
  date: string
  logs: ServiceLog[]
  totalCost: number | null
  isMulti: boolean
}

const COST_FILTERS: { key: CostFilter; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: '3mo', label: '3 Mo' },
  { key: '6mo', label: '6 Mo' },
  { key: 'year', label: 'Year' },
]

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
    const key = log.session_id ?? log.id
    const arr = map.get(key) ?? []
    arr.push(log)
    map.set(key, arr)
  }
  return Array.from(map.entries()).map(([key, items]) => {
    const hasCost = items.some(l => l.cost != null)
    return {
      key,
      date: items.reduce((a, b) => (a > b.date ? a : b.date), items[0].date),
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
  const [loading, setLoading] = useState(true)

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
  const [editingCatSuggestion, setEditingCatSuggestion] = useState<{ original: string; edited: string } | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<ServiceGroup | null>(null)

  const [costFilter, setCostFilter] = useState<CostFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true)
    const [{ data: logsData }, { data: catsData }] = await Promise.all([
      supabase.from('service_logs').select('*').eq('vehicle_id', vehicle.id).order('date', { ascending: false }),
      supabase.from('service_categories').select('*').eq('vehicle_id', vehicle.id).eq('category_type', 'maintenance').order('name'),
    ])
    setLogs(logsData ?? [])
    setCategories(catsData ?? [])
    setLoading(false)
  }, [vehicle])

  useEffect(() => { load() }, [load])

  // Keep selected group in sync after reload
  useEffect(() => {
    if (selectedGroup) {
      const updated = groupLogs(logs).find(g => g.key === selectedGroup.key)
      if (updated) setSelectedGroup(updated)
    }
  }, [logs]) // eslint-disable-line

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
    else { setReceiptFile(file); setReceiptPreview(null) }
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
    if (log?.receipt_url) await supabase.storage.from('receipts').remove([log.receipt_url])
    await supabase.from('service_logs').delete().eq('id', id)
    setDeleteId(null)
    // Clear selection if the deleted log's group is now empty
    if (selectedGroup?.logs.some(l => l.id === id)) {
      const remaining = selectedGroup.logs.filter(l => l.id !== id)
      if (remaining.length === 0) setSelectedGroup(null)
    }
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
    const { data: newCat } = await supabase
      .from('service_categories')
      .insert({ user_id: user.id, vehicle_id: vehicle.id, name: finalName, category_type: 'maintenance' })
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
    setEditingCatSuggestion(null)
  }

  // Derived data
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
  const maintenanceCats = categories.filter(c => c.category_type === 'maintenance')
  const activeFilterCount = (costFilter !== 'all' ? 1 : 0) + (typeFilter ? 1 : 0) + (sortKey !== 'date' ? 1 : 0)
  const hasUnlinkedLogs = categories.some(cat => logs.some(l => l.service_type === cat.name && l.category_id == null))
  const typeAvgs = typeFilter ? computeTypeAverages(logs, typeFilter) : null

  // ─── Group detail content (shared between desktop panel + mobile sheet) ────
  const renderGroupDetail = (group: ServiceGroup) => {
    const maxOdo = Math.max(...group.logs.map(l => l.odometer))
    const firstShop = group.logs.find(l => l.shop_name)
    const receipts = group.logs.filter(l => l.receipt_url)

    if (!group.isMulti) {
      const log = group.logs[0]
      const isOwner = log.performed_by === 'owner'
      return (
        <div className="space-y-5">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-zinc-100">{log.service_type}</h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${log.record_type === 'repair' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>
                  {log.record_type === 'repair' ? 'Repair' : 'Maintenance'}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${isOwner ? 'bg-blue-500/15 text-blue-300' : 'bg-green-500/10 text-green-400'}`}>
                  {isOwner ? '🔧 DIY' : '🏪 Shop'}
                </span>
              </div>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button onClick={() => openEdit(log)} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-xl transition-colors"><Pencil size={12} /> Edit</button>
              <button onClick={() => setDeleteId(log.id)} className="p-1.5 bg-zinc-800 hover:bg-red-500/15 text-zinc-400 hover:text-red-400 rounded-xl transition-colors"><Trash2 size={14} /></button>
            </div>
          </div>

          {/* Details */}
          <div className="bg-zinc-800/40 border border-zinc-800 rounded-2xl divide-y divide-zinc-800">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-zinc-500 text-sm">Date</span>
              <span className="text-zinc-200 text-sm font-medium">{format(parseISO(log.date), 'MMM d, yyyy')}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-zinc-500 text-sm">Odometer</span>
              <span className="text-zinc-200 text-sm font-medium">{log.odometer.toLocaleString()} mi</span>
            </div>
            {log.cost != null && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-zinc-500 text-sm">Cost</span>
                <span className="text-amber-400 text-sm font-bold">${Number(log.cost).toFixed(2)}</span>
              </div>
            )}
            {log.shop_name && (
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-zinc-500 text-sm">Shop</span>
                <span className="text-zinc-200 text-sm">{log.shop_name}{log.shop_location ? `, ${log.shop_location}` : ''}</span>
              </div>
            )}
            {log.notes && (
              <div className="px-4 py-3">
                <p className="text-zinc-500 text-sm mb-1">Notes</p>
                <p className="text-zinc-300 text-sm">{log.notes}</p>
              </div>
            )}
          </div>

          {/* Receipt */}
          {log.receipt_url && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-600 mb-3">Receipt</p>
              <ReceiptViewer path={log.receipt_url} className="min-h-40 max-h-[400px]" />
            </div>
          )}
        </div>
      )
    }

    // Multi-item session
    return (
      <div className="space-y-5">
        {/* Session header */}
        <div>
          <h3 className="text-xl font-bold text-zinc-100">Service Session</h3>
          <p className="text-zinc-500 text-sm mt-1">{format(parseISO(group.date), 'MMM d, yyyy')} · {maxOdo.toLocaleString()} mi{firstShop ? ` · ${firstShop.shop_name}` : ''}</p>
          {group.totalCost != null && <p className="text-amber-400 font-bold mt-1">Total: ${group.totalCost.toFixed(2)}</p>}
        </div>

        {/* Each log */}
        <div className="space-y-3">
          {group.logs.map(log => {
            const isOwner = log.performed_by === 'owner'
            return (
              <div key={log.id} className={`border rounded-2xl overflow-hidden ${isOwner ? 'bg-blue-950/20 border-blue-900/30' : 'bg-zinc-800/40 border-zinc-800'}`}>
                <div className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-zinc-100 font-semibold text-sm">{log.service_type}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${log.record_type === 'repair' ? 'bg-orange-500/10 text-orange-400' : 'bg-blue-500/10 text-blue-400'}`}>{log.record_type === 'repair' ? 'Repair' : 'Maint.'}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${isOwner ? 'bg-blue-500/15 text-blue-300' : 'bg-green-500/10 text-green-400'}`}>{isOwner ? '🔧 DIY' : '🏪 Shop'}</span>
                        {log.cost != null && <span className="text-amber-400 font-bold text-sm ml-auto">${Number(log.cost).toFixed(2)}</span>}
                      </div>
                      {log.notes && <p className="text-zinc-600 text-xs mt-1 line-clamp-2">{log.notes}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(log)} className="w-7 h-7 rounded-lg bg-zinc-800/60 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"><Pencil size={12} /></button>
                      <button onClick={() => setDeleteId(log.id)} className="w-7 h-7 rounded-lg bg-zinc-800/60 flex items-center justify-center text-zinc-400 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                    </div>
                  </div>
                </div>
                {log.receipt_url && (
                  <div className="border-t border-zinc-800/50 px-4 py-3">
                    <p className="text-xs text-zinc-600 mb-2 flex items-center gap-1"><Paperclip size={10} /> Receipt</p>
                    <ReceiptViewer path={log.receipt_url} className="min-h-32 max-h-72" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-zinc-950 min-h-screen lg:h-screen lg:flex lg:flex-col">

      {/* ─── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-12 pb-3 lg:shrink-0 lg:border-b lg:border-zinc-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">History</p>
            <h1 className="text-xl font-bold text-zinc-100 mt-0.5">Service Log</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowExport(true)} className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors" title="Export PDF"><FileText size={16} /></button>
            <button onClick={() => setShowCarfaxImport(true)} className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors" title="Import from Carfax"><Upload size={16} /></button>
            <button onClick={() => setShowCategoryManager(true)} className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors" title="Manage Categories"><Settings size={16} /></button>
            <button onClick={() => setShowAddFlow(true)} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-2xl px-4 py-2.5 text-sm transition-colors shadow-lg shadow-amber-500/20">
              <Plus size={16} /> Add
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowFilterModal(true)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors border ${activeFilterCount > 0 ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}
          >
            <SlidersHorizontal size={15} /> Filters
            {activeFilterCount > 0 && <span className="bg-amber-500 text-zinc-950 text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">{activeFilterCount}</span>}
          </button>
          {typeFilter && (
            <div className="flex items-center gap-1.5 bg-blue-500/10 border border-blue-500/20 rounded-xl px-3 py-2">
              <span className="text-blue-300 text-sm font-medium truncate max-w-[140px]">{typeFilter}</span>
              <button onClick={() => setTypeFilter(null)} className="text-blue-400 hover:text-blue-200 shrink-0"><X size={13} /></button>
            </div>
          )}
          {costFilter !== 'all' && (
            <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2">
              <span className="text-zinc-300 text-sm font-medium">{COST_FILTERS.find(f => f.key === costFilter)?.label}</span>
              <button onClick={() => setCostFilter('all')} className="text-zinc-400 hover:text-zinc-200"><X size={13} /></button>
            </div>
          )}
          {sortKey !== 'date' && (
            <div className="flex items-center gap-1.5 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2">
              <span className="text-zinc-300 text-sm font-medium capitalize">↕ {sortKey}</span>
              <button onClick={() => setSortKey('date')} className="text-zinc-400 hover:text-zinc-200"><X size={13} /></button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Two-column content area ─────────────────────────────────────────── */}
      <div className="lg:flex lg:flex-1 lg:overflow-hidden">

        {/* Left: compact list */}
        <div className="lg:w-72 xl:w-80 lg:border-r lg:border-zinc-800 lg:overflow-y-auto lg:flex-shrink-0">

          {/* Banners (show above list) */}
          <div className="px-4 pt-3 space-y-2">
            {typeFilter && typeAvgs && (typeAvgs.avgMiles || typeAvgs.avgDays) && (
              <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
                <span className="text-zinc-400 text-xs">Avg: <span className="text-zinc-200 font-semibold">{typeFilter}</span></span>
                {typeAvgs.avgMiles && <span className="text-amber-400 text-xs font-bold">{typeAvgs.avgMiles.toLocaleString()} mi</span>}
                {typeAvgs.avgDays && <span className="text-zinc-500 text-xs">· {Math.round(typeAvgs.avgDays / 30)} mo</span>}
              </div>
            )}
            {hasUnlinkedLogs && (
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                <p className="text-blue-300 text-xs font-medium">Service records aren&apos;t linked to their categories yet.</p>
                <button onClick={repairCategoryLinks} className="text-blue-400 text-xs font-bold hover:text-blue-300 transition-colors shrink-0 whitespace-nowrap">Fix Now →</button>
              </div>
            )}

            {uncategorizedTypes.length > 0 && (
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2.5">
                <p className="text-amber-400 text-xs font-semibold mb-2">{uncategorizedTypes.length} imported type{uncategorizedTypes.length !== 1 ? 's' : ''} — add to categories:</p>
                <div className="flex flex-wrap gap-1.5">
                  {uncategorizedTypes.slice(0, 4).map(t => {
                    const isEditing = editingCatSuggestion?.original === t
                    if (isEditing) {
                      return (
                        <div key={t} className="flex items-center gap-1 bg-amber-500/15 border border-amber-500/40 rounded-lg px-1.5 py-0.5">
                          <input
                            type="text"
                            value={editingCatSuggestion.edited}
                            onChange={e => setEditingCatSuggestion({ original: t, edited: e.target.value })}
                            onKeyDown={e => {
                              if (e.key === 'Enter') addAsCategory(t, editingCatSuggestion.edited)
                              if (e.key === 'Escape') setEditingCatSuggestion(null)
                            }}
                            className="bg-transparent text-xs text-amber-200 outline-none w-32"
                            autoFocus
                          />
                          <button onClick={() => addAsCategory(t, editingCatSuggestion.edited)} disabled={addingCategory === t} className="text-amber-400 hover:text-green-400 transition-colors disabled:opacity-50">
                            <Check size={11} />
                          </button>
                          <button onClick={() => setEditingCatSuggestion(null)} className="text-amber-600 hover:text-amber-300 transition-colors">
                            <X size={11} />
                          </button>
                        </div>
                      )
                    }
                    return (
                      <button key={t}
                        onClick={() => setEditingCatSuggestion({ original: t, edited: t })}
                        disabled={addingCategory === t}
                        className="flex items-center gap-1 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 rounded-lg px-2 py-0.5 text-xs text-amber-300 font-medium transition-colors disabled:opacity-50"
                        title="Click to add (or rename before adding)"
                      >
                        <Plus size={9} /> {t}
                      </button>
                    )
                  })}
                  {uncategorizedTypes.length > 4 && <button onClick={() => setShowCategoryManager(true)} className="text-amber-500/70 text-xs underline self-center">+{uncategorizedTypes.length - 4} more</button>}
                </div>
              </div>
            )}

            {/* Stats */}
            {logs.length > 0 && (
              <div className="flex gap-2 pb-1">
                <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-center">
                  <p className="text-sm font-bold text-zinc-100">{timeFiltered.length}</p>
                  <p className="text-xs text-zinc-500">Records</p>
                </div>
                <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-center">
                  <p className="text-sm font-bold text-amber-400">${filteredCost.toFixed(0)}</p>
                  <p className="text-xs text-zinc-500">Spend</p>
                </div>
              </div>
            )}
          </div>

          {/* Service list */}
          <div className="lg:pb-8 pb-2">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {!loading && sortedGroups.length === 0 && (
              <div className="text-center py-16 px-4">
                <Wrench size={40} className="text-zinc-700 mx-auto mb-3" />
                <p className="text-zinc-400 font-medium">No service records yet</p>
                <p className="text-zinc-600 text-sm mt-1">Tap + Add or Import from Carfax</p>
              </div>
            )}
            {sortedGroups.map(group => {
              const primaryType = group.isMulti
                ? Array.from(new Set(group.logs.map(l => l.service_type))).slice(0, 2).join(' · ') + (group.logs.length > 2 ? ` +${group.logs.length - 2}` : '')
                : group.logs[0].service_type
              const maxOdo = Math.max(...group.logs.map(l => l.odometer))
              const hasReceipt = group.logs.some(l => l.receipt_url)
              const isSelected = selectedGroup?.key === group.key
              const isOwnerOnly = !group.isMulti && group.logs[0].performed_by === 'owner'

              return (
                <button
                  key={group.key}
                  onClick={() => setSelectedGroup(isSelected ? null : group)}
                  className={`w-full flex items-start gap-3 px-4 py-3 border-b border-zinc-800/60 text-left transition-colors ${
                    isSelected ? 'bg-zinc-800/80 lg:border-l-2 lg:border-l-amber-500' : isOwnerOnly ? 'bg-blue-950/15 hover:bg-blue-950/30' : 'hover:bg-zinc-800/40'
                  }`}
                >
                  <div className="flex-1 min-w-0 mt-0.5">
                    <p className={`text-sm font-medium truncate ${isSelected ? 'text-amber-400' : 'text-zinc-100'}`}>{primaryType}</p>
                    <p className="text-zinc-500 text-xs mt-0.5">{format(parseISO(group.date), 'MMM d, yyyy')} · {maxOdo.toLocaleString()} mi</p>
                    {group.isMulti && <p className="text-zinc-600 text-xs">{group.logs.length} services</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mt-1">
                    {hasReceipt && <Paperclip size={11} className="text-amber-500/60" />}
                    {group.totalCost != null && <span className="text-amber-400 text-xs font-semibold">${group.totalCost.toFixed(0)}</span>}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Mobile: detail shown inline as bottom sheet */}
          {selectedGroup && (
            <div className="lg:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end" onClick={() => setSelectedGroup(null)}>
              <div className="w-full bg-zinc-900 border-t border-zinc-800 rounded-t-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-zinc-900/95 backdrop-blur-sm pt-4 pb-3 px-6 border-b border-zinc-800/60">
                  <div className="w-12 h-1 bg-zinc-700 rounded-full mx-auto mb-3" />
                </div>
                <div className="px-6 py-5 pb-10">
                  {renderGroupDetail(selectedGroup)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: detail panel (desktop only) */}
        <div className="hidden lg:flex lg:flex-1 lg:overflow-y-auto lg:flex-col">
          {selectedGroup ? (
            <div className="p-6 pb-10">
              {renderGroupDetail(selectedGroup)}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Wrench size={40} className="text-zinc-800 mx-auto mb-3" />
                <p className="text-zinc-600 font-medium">Select a service record</p>
                <p className="text-zinc-700 text-sm mt-1">to view details, receipts, and edit options</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Filter Modal ── */}
      {showFilterModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-zinc-100 text-lg">Filter & Sort</h3>
              <button onClick={() => setShowFilterModal(false)} className="text-zinc-500 hover:text-zinc-300"><X size={20} /></button>
            </div>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Time Range</label>
                <div className="flex flex-wrap gap-2">
                  {COST_FILTERS.map(f => (
                    <button key={f.key} onClick={() => setCostFilter(f.key)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${costFilter === f.key ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Sort By</label>
                <div className="flex gap-2">
                  {(['date', 'odometer', 'cost'] as SortKey[]).map(k => (
                    <button key={k} onClick={() => setSortKey(k)}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium capitalize transition-colors border ${sortKey === k ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              {allTypes.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Service Type</label>
                  <select value={typeFilter ?? ''} onChange={e => setTypeFilter(e.target.value || null)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:border-amber-500/70 transition-all appearance-none">
                    <option value="">All Types</option>
                    {allTypes.map(t => <option key={t} value={t}>{t}{!categoryNames.has(t) ? ' (uncategorized)' : ''}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setCostFilter('all'); setSortKey('date'); setTypeFilter(null); setShowFilterModal(false) }}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Reset All</button>
              <button onClick={() => setShowFilterModal(false)}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-2xl py-3 transition-colors">Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editLog && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-zinc-100 text-lg">Edit Service</h3>
              <button onClick={() => setEditLog(null)} className="text-zinc-500 hover:text-zinc-300"><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Category</label>
                <div className="flex gap-2">
                  {(['maintenance', 'repair'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setForm(f => ({ ...f, record_type: t, category_id: '', service_type: '' }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${form.record_type === t ? t === 'maintenance' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-orange-500/20 text-orange-300 border border-orange-500/40' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>{t}</button>
                  ))}
                </div>
              </div>
              {form.record_type === 'maintenance' ? (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Sub-category</label>
                  <select value={form.category_id} onChange={e => { const cat = categories.find(c => c.id === e.target.value); setForm(f => ({ ...f, category_id: e.target.value, service_type: cat?.name ?? '' })) }} required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:border-amber-500/70 transition-all appearance-none">
                    <option value="">Select category…</option>
                    {maintenanceCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Repair Description</label>
                  <input type="text" placeholder="e.g. Replaced front struts" value={form.service_type} onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))} required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Date</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 focus:outline-none focus:border-amber-500/70 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Odometer (mi)</label>
                  <input type="number" placeholder="24500" value={form.odometer} onChange={e => setForm(f => ({ ...f, odometer: e.target.value }))} required min="0"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Cost ($)</label>
                <input type="number" placeholder="0.00" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} min="0" step="0.01"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Performed by</label>
                <div className="flex gap-2">
                  {(['owner', 'shop'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setForm(f => ({ ...f, performed_by: t }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${form.performed_by === t ? t === 'owner' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-green-500/20 text-green-300 border border-green-500/40' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>{t === 'owner' ? '🔧 DIY' : '🏪 Shop'}</button>
                  ))}
                </div>
              </div>
              {form.performed_by === 'shop' && (
                <div className="space-y-3">
                  <input type="text" placeholder="Shop name" value={form.shop_name} onChange={e => setForm(f => ({ ...f, shop_name: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all" />
                  <input type="text" placeholder="Location (optional)" value={form.shop_location} onChange={e => setForm(f => ({ ...f, shop_location: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Notes (optional)</label>
                <textarea placeholder="Parts used, observations, etc." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Receipt (optional)</label>
                {receiptPreview && (
                  <div className="relative mb-2">
                    <img src={receiptPreview} alt="Receipt preview" className="w-full rounded-xl max-h-40 object-contain bg-zinc-800" />
                    <button type="button" onClick={() => { setReceiptFile(null); setReceiptPreview(null); if (fileRef.current) fileRef.current.value = '' }}
                      className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"><X size={12} /></button>
                  </div>
                )}
                {receiptFile && !receiptPreview && (
                  <div className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 py-2 mb-2">
                    <FileText size={14} className="text-zinc-400" />
                    <span className="text-zinc-300 text-sm truncate">{receiptFile.name}</span>
                    <button type="button" onClick={() => { setReceiptFile(null); if (fileRef.current) fileRef.current.value = '' }} className="ml-auto text-zinc-500 hover:text-zinc-300"><X size={14} /></button>
                  </div>
                )}
                {editLog.receipt_url && !receiptFile && (
                  <div className="mb-2">
                    <p className="text-xs text-amber-500/70 mb-1.5">📎 Current receipt — upload new to replace</p>
                    <ReceiptViewer path={editLog.receipt_url} className="min-h-32 max-h-48" />
                  </div>
                )}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleFileChange} className="hidden" />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 w-full border-2 border-dashed border-zinc-700 hover:border-amber-500/40 rounded-xl px-4 py-2.5 text-zinc-500 hover:text-amber-500 text-sm transition-colors">
                  <Image size={14} />{receiptFile ? 'Change Receipt' : 'Attach Receipt (JPG, PNG, PDF)'}
                </button>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditLog(null)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-3 transition-colors">{saving ? 'Saving…' : 'Update'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-xs text-center">
            <p className="font-bold text-zinc-100 mb-2">Delete this record?</p>
            <p className="text-zinc-500 text-sm mb-6">Receipt (if any) will also be removed. This can&apos;t be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteId(null)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Cancel</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold rounded-2xl py-3 transition-colors">Delete</button>
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
    </div>
  )
}
