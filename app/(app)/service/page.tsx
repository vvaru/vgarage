'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { format, parseISO, subDays, subMonths, subYears } from 'date-fns'
import { Plus, Pencil, Trash2, X, Wrench, Settings, FileText, Upload, Image } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import type { ServiceLog, ServiceCategory } from '@/lib/types'
import dynamic from 'next/dynamic'

const CategoryManagerModal = dynamic(() => import('@/components/service/CategoryManagerModal'), { ssr: false })
const CarfaxImportModal = dynamic(() => import('@/components/service/CarfaxImportModal'), { ssr: false })
const ExportPdfModal = dynamic(() => import('@/components/service/ExportPdfModal'), { ssr: false })
const ImageCropModal = dynamic(() => import('@/components/service/ImageCropModal'), { ssr: false })

type CostFilter = 'week' | 'month' | '3mo' | '6mo' | 'year' | 'all'
type SortKey = 'date' | 'odometer' | 'cost'

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

  const [showForm, setShowForm] = useState(false)
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
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const [costFilter, setCostFilter] = useState<CostFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')

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

  function openAdd() {
    setEditLog(null)
    setReceiptFile(null)
    setReceiptPreview(null)
    setForm({ ...EMPTY_FORM, odometer: vehicle ? String(vehicle.odometer) : '' })
    setShowForm(true)
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
    setShowForm(true)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.type.startsWith('image/')) {
      setCropSourceFile(file)
    } else {
      setReceiptFile(file)
      setReceiptPreview(null)
    }
  }

  function handleCropConfirm(compressed: File) {
    setCropSourceFile(null)
    setReceiptFile(compressed)
    setReceiptPreview(URL.createObjectURL(compressed))
  }

  function handleCropCancel() {
    setCropSourceFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function uploadReceipt(file: File, userId: string): Promise<string | null> {
    const ext = file.name.split('.').pop() ?? 'jpg'
    const path = `${userId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('receipts').upload(path, file)
    if (error) return null
    return path
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!vehicle || !user) return
    setSaving(true)

    const catId = form.record_type === 'maintenance' && form.category_id ? form.category_id : null
    const cat = catId ? categories.find(c => c.id === catId) : null
    const serviceType = form.record_type === 'maintenance'
      ? (cat?.name ?? form.service_type.trim())
      : form.service_type.trim()

    let receiptUrl = editLog?.receipt_url ?? null
    if (receiptFile) {
      const path = await uploadReceipt(receiptFile, user.id)
      if (path) {
        if (receiptUrl) {
          await supabase.storage.from('receipts').remove([receiptUrl])
        }
        receiptUrl = path
      }
    }

    const payload = {
      user_id: user.id,
      vehicle_id: vehicle.id,
      service_type: serviceType,
      category_id: catId,
      record_type: form.record_type,
      performed_by: form.performed_by,
      shop_name: form.performed_by === 'shop' ? (form.shop_name.trim() || null) : null,
      shop_location: form.performed_by === 'shop' ? (form.shop_location.trim() || null) : null,
      receipt_url: receiptUrl,
      date: form.date,
      odometer: parseInt(form.odometer),
      cost: form.cost ? parseFloat(form.cost) : null,
      notes: form.notes.trim() || null,
    }

    if (editLog) {
      await supabase.from('service_logs').update(payload).eq('id', editLog.id)
    } else {
      await supabase.from('service_logs').insert(payload)
      if (vehicle && parseInt(form.odometer) > vehicle.odometer) {
        await supabase.from('vehicles').update({ odometer: parseInt(form.odometer) }).eq('id', vehicle.id)
      }
    }

    await load()
    setShowForm(false)
    setSaving(false)
  }

  async function handleDelete(id: string) {
    const log = logs.find(l => l.id === id)
    if (log?.receipt_url) {
      await supabase.storage.from('receipts').remove([log.receipt_url])
    }
    await supabase.from('service_logs').delete().eq('id', id)
    setDeleteId(null)
    await load()
  }

  const cutoff = cutoffDate(costFilter)
  const filteredLogs = cutoff
    ? logs.filter(l => parseISO(l.date) >= cutoff)
    : logs

  const sorted = [...filteredLogs].sort((a, b) => {
    if (sortKey === 'date') return b.date.localeCompare(a.date)
    if (sortKey === 'odometer') return b.odometer - a.odometer
    return (Number(b.cost) ?? 0) - (Number(a.cost) ?? 0)
  })

  const filteredCost = filteredLogs.reduce((s, l) => s + Number(l.cost ?? 0), 0)
  const maintenanceCats = categories.filter(c => c.category_type === 'maintenance')

  return (
    <div className="bg-zinc-950 min-h-screen">
      {/* Header */}
      <div className="px-4 pt-12 pb-3 flex items-center justify-between">
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">History</p>
          <h1 className="text-xl font-bold text-zinc-100 mt-0.5">Service Log</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExport(true)}
            className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Export PDF"
          >
            <FileText size={16} />
          </button>
          <button
            onClick={() => setShowCarfaxImport(true)}
            className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Import from Carfax"
          >
            <Upload size={16} />
          </button>
          <button
            onClick={() => setShowCategoryManager(true)}
            className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Manage Categories"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-2xl px-4 py-2.5 text-sm transition-colors shadow-lg shadow-amber-500/20"
          >
            <Plus size={16} />
            Add
          </button>
        </div>
      </div>

      {/* Cost filter */}
      <div className="px-4 mb-3 flex gap-1.5 overflow-x-auto scrollbar-hide">
        {COST_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setCostFilter(f.key)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              costFilter === f.key
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      {logs.length > 0 && (
        <div className="px-4 mb-4 flex gap-3">
          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-base font-bold text-zinc-100">{filteredLogs.length}</p>
            <p className="text-xs text-zinc-500">{costFilter === 'all' ? 'Total' : 'Filtered'} Records</p>
          </div>
          <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
            <p className="text-base font-bold text-amber-400">${filteredCost.toFixed(2)}</p>
            <p className="text-xs text-zinc-500">{costFilter === 'all' ? 'Total' : COST_FILTERS.find(f => f.key === costFilter)?.label} Spend</p>
          </div>
        </div>
      )}

      {/* Sort */}
      {logs.length > 0 && (
        <div className="px-4 mb-3 flex gap-2">
          {(['date', 'odometer', 'cost'] as SortKey[]).map(k => (
            <button
              key={k}
              onClick={() => setSortKey(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                sortKey === k
                  ? 'bg-amber-500/10 text-amber-500 border border-amber-500/30'
                  : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {/* Log list */}
      <div className="px-4 space-y-2 pb-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-7 h-7 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && sorted.length === 0 && (
          <div className="text-center py-16">
            <Wrench size={40} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400 font-medium">No service records yet</p>
            <p className="text-zinc-600 text-sm mt-1">Tap + Add or Import from Carfax</p>
          </div>
        )}

        {sorted.map(log => (
          <div key={log.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-zinc-100">{log.service_type}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                    log.record_type === 'repair'
                      ? 'bg-orange-500/10 text-orange-400'
                      : 'bg-blue-500/10 text-blue-400'
                  }`}>
                    {log.record_type === 'repair' ? 'Repair' : 'Maintenance'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                    log.performed_by === 'shop'
                      ? 'bg-green-500/10 text-green-400'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {log.performed_by === 'shop' ? '🏪 Shop' : '🔧 Owner'}
                  </span>
                  {log.cost != null && (
                    <span className="text-amber-400 font-bold text-sm ml-auto">
                      ${Number(log.cost).toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500">
                  <span>{format(parseISO(log.date), 'MMM d, yyyy')}</span>
                  <span>·</span>
                  <span>{log.odometer.toLocaleString()} mi</span>
                  {log.shop_name && (
                    <>
                      <span>·</span>
                      <span className="text-zinc-600">{log.shop_name}{log.shop_location && `, ${log.shop_location}`}</span>
                    </>
                  )}
                </div>
                {log.notes && (
                  <p className="text-zinc-600 text-sm mt-1.5 line-clamp-2">{log.notes}</p>
                )}
                {log.receipt_url && (
                  <p className="text-xs text-amber-500/70 mt-1">📎 Receipt attached</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEdit(log)} className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors">
                  <Pencil size={14} />
                </button>
                <button onClick={() => setDeleteId(log.id)} className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Add / Edit Form Modal ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-zinc-100 text-lg">{editLog ? 'Edit Service' : 'Log Service'}</h3>
              <button onClick={() => setShowForm(false)} className="text-zinc-500 hover:text-zinc-300">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              {/* Record type toggle */}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Category</label>
                <div className="flex gap-2">
                  {(['maintenance', 'repair'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, record_type: t, category_id: '', service_type: '' }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${
                        form.record_type === t
                          ? t === 'maintenance' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                          : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-category or description */}
              {form.record_type === 'maintenance' ? (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Sub-category</label>
                  <select
                    value={form.category_id}
                    onChange={e => {
                      const cat = categories.find(c => c.id === e.target.value)
                      setForm(f => ({ ...f, category_id: e.target.value, service_type: cat?.name ?? '' }))
                    }}
                    required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:border-amber-500/70 transition-all appearance-none"
                  >
                    <option value="">Select category…</option>
                    {maintenanceCats.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {maintenanceCats.length === 0 && (
                    <p className="text-amber-400 text-xs mt-1">
                      No maintenance categories yet. Create one in ⚙ Manage Categories.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Repair Description</label>
                  <input
                    type="text"
                    placeholder="e.g. Replaced front struts"
                    value={form.service_type}
                    onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))}
                    required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all"
                  />
                </div>
              )}

              {/* Date + Odometer */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 focus:outline-none focus:border-amber-500/70 transition-all"
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
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all"
                  />
                </div>
              </div>

              {/* Cost */}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Cost ($)</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={form.cost}
                  onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
                  min="0"
                  step="0.01"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all"
                />
              </div>

              {/* Performed by */}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Performed by</label>
                <div className="flex gap-2">
                  {(['owner', 'shop'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, performed_by: t }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${
                        form.performed_by === t
                          ? t === 'owner' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-green-500/20 text-green-300 border border-green-500/40'
                          : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                      }`}
                    >
                      {t === 'owner' ? '🔧 Owner' : '🏪 Shop'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shop fields */}
              {form.performed_by === 'shop' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Shop Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Jiffy Lube"
                      value={form.shop_name}
                      onChange={e => setForm(f => ({ ...f, shop_name: e.target.value }))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1.5">Shop Location (optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Austin, TX"
                      value={form.shop_location}
                      onChange={e => setForm(f => ({ ...f, shop_location: e.target.value }))}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Notes (optional)</label>
                <textarea
                  placeholder="Parts used, observations, etc."
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all resize-none"
                />
              </div>

              {/* Receipt upload */}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Receipt (optional)</label>
                {receiptPreview && (
                  <div className="relative mb-2">
                    <img src={receiptPreview} alt="Receipt preview" className="w-full rounded-xl max-h-40 object-contain bg-zinc-800" />
                    <button
                      type="button"
                      onClick={() => { setReceiptFile(null); setReceiptPreview(null); if (fileRef.current) fileRef.current.value = '' }}
                      className="absolute top-2 right-2 w-6 h-6 bg-black/60 rounded-full flex items-center justify-center text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                {receiptFile && !receiptPreview && (
                  <div className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 py-2 mb-2">
                    <FileText size={14} className="text-zinc-400" />
                    <span className="text-zinc-300 text-sm truncate">{receiptFile.name}</span>
                    <button type="button" onClick={() => { setReceiptFile(null); if (fileRef.current) fileRef.current.value = '' }} className="ml-auto text-zinc-500 hover:text-zinc-300">
                      <X size={14} />
                    </button>
                  </div>
                )}
                {editLog?.receipt_url && !receiptFile && (
                  <p className="text-xs text-amber-500/70 mb-2">📎 Receipt already attached — upload new to replace</p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 w-full border-2 border-dashed border-zinc-700 hover:border-amber-500/40 rounded-xl px-4 py-2.5 text-zinc-500 hover:text-amber-500 text-sm transition-colors"
                >
                  <Image size={14} />
                  {receiptFile ? 'Change Receipt' : 'Attach Receipt (JPG, PNG, PDF)'}
                </button>
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-3 transition-colors">
                  {saving ? 'Saving…' : editLog ? 'Update' : 'Save'}
                </button>
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

      {/* Lazy-loaded modals */}
      {showCategoryManager && vehicle && (
        <CategoryManagerModal
          vehicle={vehicle}
          onClose={() => setShowCategoryManager(false)}
          onUpdated={load}
        />
      )}
      {showCarfaxImport && vehicle && (
        <CarfaxImportModal
          vehicle={vehicle}
          categories={categories}
          onClose={() => setShowCarfaxImport(false)}
          onImported={load}
        />
      )}
      {showExport && vehicle && (
        <ExportPdfModal
          vehicle={vehicle}
          logs={logs}
          onClose={() => setShowExport(false)}
        />
      )}
      {cropSourceFile && (
        <ImageCropModal
          file={cropSourceFile}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  )
}
