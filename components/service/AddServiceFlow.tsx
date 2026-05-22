'use client'

import { useState, useRef, useCallback } from 'react'
import { format, parseISO, differenceInDays } from 'date-fns'
import { X, Plus, Trash2, Image, ChevronLeft, ChevronRight, Check, Package, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import type { Vehicle, ServiceCategory } from '@/lib/types'
import dynamic from 'next/dynamic'

const ImageCropModal = dynamic(() => import('./ImageCropModal'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReceiptDraft {
  file: File
  preview: string
}

interface ItemDraft {
  kind: 'service' | 'product'
  record_type: 'maintenance' | 'repair'
  category_id: string
  service_type: string
  performed_by: 'owner' | 'shop'
  shop_name: string
  shop_location: string
  date: string
  odometer: string
  cost: string
  notes: string
  receiptIdx: number | null
}

type Step = 'receipts' | 'count' | 'items'

interface OdoReading {
  date: string
  odo: number
}

interface Props {
  vehicle: Vehicle
  categories: ServiceCategory[]
  historicalReadings?: OdoReading[]
  milesPerMonth?: number
  onClose: () => void
  onSaved: () => void
}

function estimateOdoForDate(date: string, readings: OdoReading[], milesPerMonth: number): number | null {
  const target = parseISO(date)
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return null

  const before = [...sorted].reverse().find(r => parseISO(r.date) <= target)
  const after = sorted.find(r => parseISO(r.date) > target)

  if (before && after) {
    const totalDays = differenceInDays(parseISO(after.date), parseISO(before.date))
    if (totalDays <= 0) return before.odo
    const ratio = differenceInDays(target, parseISO(before.date)) / totalDays
    return Math.round(before.odo + (after.odo - before.odo) * ratio)
  }
  if (before) {
    const days = differenceInDays(new Date(), parseISO(before.date))
    if (days <= 0) return before.odo
    const daysToBefore = differenceInDays(new Date(), target)
    return Math.max(0, Math.round(before.odo - (milesPerMonth / 30) * daysToBefore))
  }
  return null
}

const TODAY = format(new Date(), 'yyyy-MM-dd')

function emptyItem(kind: 'service' | 'product', defaultDate: string, defaultOdo: string): ItemDraft {
  return {
    kind,
    record_type: 'maintenance',
    category_id: '',
    service_type: '',
    performed_by: 'shop',
    shop_name: '',
    shop_location: '',
    date: defaultDate,
    odometer: defaultOdo,
    cost: '',
    notes: '',
    receiptIdx: null,
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AddServiceFlow({ vehicle, categories, historicalReadings = [], milesPerMonth = 1250, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('receipts')
  const [receipts, setReceipts] = useState<ReceiptDraft[]>([])
  const [cropFile, setCropFile] = useState<File | null>(null)

  const [sessionDate, setSessionDate] = useState(TODAY)
  const [sessionOdo, setSessionOdo] = useState(String(vehicle.odometer))
  const [serviceCount, setServiceCount] = useState(1)
  const [productCount, setProductCount] = useState(0)

  const [items, setItems] = useState<ItemDraft[]>([])
  const [activeItem, setActiveItem] = useState(0)
  const [saving, setSaving] = useState(false)

  const totalItems = serviceCount + productCount

  // ─── Receipts step ──────────────────────────────────────────────────────────
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.type.startsWith('image/')) {
      setCropFile(file)
    } else {
      addReceiptDirect(file)
    }
  }

  function addReceiptDirect(file: File) {
    const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
    setReceipts(r => [...r, { file, preview }])
  }

  function handleCropConfirm(compressed: File) {
    const preview = URL.createObjectURL(compressed)
    setReceipts(r => [...r, { file: compressed, preview }])
    setCropFile(null)
  }

  function removeReceipt(idx: number) {
    setReceipts(prev => {
      URL.revokeObjectURL(prev[idx].preview)
      const next = prev.filter((_, i) => i !== idx)
      // clear receipt references on items pointing to removed receipt
      setItems(items => items.map(it => ({
        ...it,
        receiptIdx: it.receiptIdx === idx ? null : it.receiptIdx != null && it.receiptIdx > idx ? it.receiptIdx - 1 : it.receiptIdx,
      })))
      return next
    })
  }

  // ─── Date change with odometer proration ────────────────────────────────────
  function handleSessionDateChange(date: string) {
    setSessionDate(date)
    if (date < TODAY && historicalReadings.length > 0) {
      const est = estimateOdoForDate(date, historicalReadings, milesPerMonth)
      if (est != null && est > 0) setSessionOdo(String(est))
    }
  }

  // ─── Count step → Items ─────────────────────────────────────────────────────
  function buildItems() {
    const list: ItemDraft[] = [
      ...Array.from({ length: serviceCount }, () => emptyItem('service', sessionDate, sessionOdo)),
      ...Array.from({ length: productCount }, () => emptyItem('product', sessionDate, sessionOdo)),
    ]
    setItems(list)
    setActiveItem(0)
    setStep('items')
  }

  // ─── Item form helpers ──────────────────────────────────────────────────────
  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  const maintenanceCats = categories.filter(c => c.category_type === 'maintenance')

  // ─── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!user) return
    setSaving(true)
    const sessionId = crypto.randomUUID()

    // Upload all receipt files first
    const uploadedPaths: (string | null)[] = await Promise.all(
      receipts.map(async r => {
        const ext = r.file.name.split('.').pop() ?? 'jpg'
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`
        const { error } = await supabase.storage.from('receipts').upload(path, r.file)
        return error ? null : path
      })
    )

    // Insert each item
    for (const item of items) {
      const cat = maintenanceCats.find(c => c.id === item.category_id)
      const serviceType = item.record_type === 'maintenance'
        ? (cat?.name ?? item.service_type.trim())
        : item.service_type.trim()

      const receiptPath = item.receiptIdx != null ? (uploadedPaths[item.receiptIdx] ?? null) : null

      await supabase.from('service_logs').insert({
        user_id: user.id,
        vehicle_id: vehicle.id,
        session_id: sessionId,
        service_type: serviceType || (item.kind === 'product' ? 'Product' : 'Service'),
        category_id: item.category_id || null,
        record_type: item.record_type,
        performed_by: item.performed_by,
        shop_name: item.performed_by === 'shop' ? (item.shop_name.trim() || null) : null,
        shop_location: item.performed_by === 'shop' ? (item.shop_location.trim() || null) : null,
        receipt_url: receiptPath,
        date: item.date,
        odometer: parseInt(item.odometer) || vehicle.odometer,
        cost: item.cost ? parseFloat(item.cost) : null,
        notes: item.notes.trim() || null,
      })
    }

    // Update odometer if any item has a higher reading
    const maxOdo = Math.max(...items.map(i => parseInt(i.odometer) || 0))
    if (maxOdo > vehicle.odometer) {
      await supabase.from('vehicles').update({ odometer: maxOdo }).eq('id', vehicle.id)
    }

    setSaving(false)
    onSaved()
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
        <div className={`bg-zinc-900 border border-zinc-800 rounded-3xl w-full flex flex-col max-h-[92vh] ${step === 'items' && receipts.length > 0 ? 'max-w-sm lg:max-w-4xl' : 'max-w-sm'}`}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0 border-b border-zinc-800">
            <div className="flex items-center gap-3">
              {step !== 'receipts' && (
                <button
                  onClick={() => setStep(step === 'items' ? 'count' : 'receipts')}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <ChevronLeft size={20} />
                </button>
              )}
              <div>
                <p className="text-zinc-500 text-xs">
                  Step {step === 'receipts' ? 1 : step === 'count' ? 2 : 3} of 3
                </p>
                <h3 className="font-bold text-zinc-100">
                  {step === 'receipts' ? 'Attach Receipts'
                    : step === 'count' ? 'What happened?'
                    : `Item ${activeItem + 1} of ${totalItems}`}
                </h3>
              </div>
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
              <X size={20} />
            </button>
          </div>

          {/* ── Step 1: Receipts ───────────────────────────────────────────── */}
          {step === 'receipts' && (
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {receipts.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {receipts.map((r, i) => (
                    <div key={i} className="relative aspect-square">
                      {r.preview ? (
                        <img src={r.preview} alt="" className="w-full h-full object-cover rounded-xl bg-zinc-800" />
                      ) : (
                        <div className="w-full h-full bg-zinc-800 rounded-xl flex items-center justify-center">
                          <Image size={20} className="text-zinc-500" />
                        </div>
                      )}
                      <button
                        onClick={() => removeReceipt(i)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center"
                      >
                        <X size={10} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleFileSelect} className="hidden" />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 w-full border-2 border-dashed border-zinc-700 hover:border-amber-500/40 rounded-xl px-4 py-3 text-zinc-500 hover:text-amber-500 text-sm transition-colors"
              >
                <Plus size={15} />
                Add Receipt (photo, scan, or PDF)
              </button>

              <p className="text-zinc-600 text-xs text-center">You can add multiple receipts. Each line item will reference one.</p>
            </div>
          )}

          {/* ── Step 2: Count ──────────────────────────────────────────────── */}
          {step === 'count' && (
            <div className="overflow-y-auto flex-1 p-5 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Date</label>
                  <input
                    type="date"
                    value={sessionDate}
                    onChange={e => handleSessionDateChange(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 focus:outline-none focus:border-amber-500/70 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Odometer (mi)</label>
                  <input
                    type="number"
                    value={sessionOdo}
                    onChange={e => setSessionOdo(e.target.value)}
                    min="0"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-3">Services performed</label>
                <div className="flex items-center gap-4">
                  <Wrench size={18} className="text-blue-400" />
                  <button onClick={() => setServiceCount(Math.max(0, serviceCount - 1))} className="w-9 h-9 bg-zinc-800 rounded-xl text-zinc-300 text-lg font-bold hover:bg-zinc-700 transition-colors">−</button>
                  <span className="text-zinc-100 font-bold text-xl w-6 text-center">{serviceCount}</span>
                  <button onClick={() => setServiceCount(serviceCount + 1)} className="w-9 h-9 bg-zinc-800 rounded-xl text-zinc-300 text-lg font-bold hover:bg-zinc-700 transition-colors">+</button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-3">Products / parts used</label>
                <div className="flex items-center gap-4">
                  <Package size={18} className="text-amber-400" />
                  <button onClick={() => setProductCount(Math.max(0, productCount - 1))} className="w-9 h-9 bg-zinc-800 rounded-xl text-zinc-300 text-lg font-bold hover:bg-zinc-700 transition-colors">−</button>
                  <span className="text-zinc-100 font-bold text-xl w-6 text-center">{productCount}</span>
                  <button onClick={() => setProductCount(productCount + 1)} className="w-9 h-9 bg-zinc-800 rounded-xl text-zinc-300 text-lg font-bold hover:bg-zinc-700 transition-colors">+</button>
                </div>
              </div>

              {totalItems === 0 && (
                <p className="text-amber-400 text-xs bg-amber-500/10 rounded-xl px-3 py-2">Add at least 1 service or product.</p>
              )}
            </div>
          )}

          {/* ── Step 3: Item forms ─────────────────────────────────────────── */}
          {step === 'items' && items[activeItem] && (
            <div className="flex flex-1 overflow-hidden">
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Item kind badge */}
              <div className="flex items-center gap-2">
                {items[activeItem].kind === 'service'
                  ? <><Wrench size={14} className="text-blue-400" /><span className="text-blue-400 text-xs font-semibold uppercase tracking-wide">Service</span></>
                  : <><Package size={14} className="text-amber-400" /><span className="text-amber-400 text-xs font-semibold uppercase tracking-wide">Product / Part</span></>
                }
              </div>

              {/* Dot progress */}
              {totalItems > 1 && (
                <div className="flex items-center gap-1.5 justify-center">
                  {items.map((_, i) => (
                    <button key={i} onClick={() => setActiveItem(i)}
                      className={`rounded-full transition-all ${i === activeItem ? 'w-4 h-2 bg-amber-500' : 'w-2 h-2 bg-zinc-700'}`}
                    />
                  ))}
                </div>
              )}

              {/* Maintenance/repair toggle */}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Type</label>
                <div className="flex gap-2">
                  {(['maintenance', 'repair'] as const).map(t => (
                    <button key={t} type="button"
                      onClick={() => updateItem(activeItem, { record_type: t, category_id: '', service_type: '' })}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${
                        items[activeItem].record_type === t
                          ? t === 'maintenance' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                          : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                      }`}
                    >{t}</button>
                  ))}
                </div>
              </div>

              {/* Sub-category or description */}
              {items[activeItem].record_type === 'maintenance' ? (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Sub-category</label>
                  <select
                    value={items[activeItem].category_id}
                    onChange={e => {
                      const cat = maintenanceCats.find(c => c.id === e.target.value)
                      updateItem(activeItem, { category_id: e.target.value, service_type: cat?.name ?? '' })
                    }}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:border-amber-500/70 transition-all appearance-none"
                  >
                    <option value="">Select category…</option>
                    {maintenanceCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Description</label>
                  <input
                    type="text"
                    placeholder="e.g. Replaced front struts"
                    value={items[activeItem].service_type}
                    onChange={e => updateItem(activeItem, { service_type: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all"
                  />
                </div>
              )}

              {/* Date + Odometer */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Date</label>
                  <input type="date" value={items[activeItem].date}
                    onChange={e => updateItem(activeItem, { date: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 focus:outline-none focus:border-amber-500/70 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-400 mb-1.5">Odometer</label>
                  <input type="number" value={items[activeItem].odometer}
                    onChange={e => updateItem(activeItem, { odometer: e.target.value })}
                    min="0"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all" />
                </div>
              </div>

              {/* Cost */}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Cost ($)</label>
                <input type="number" placeholder="0.00" value={items[activeItem].cost}
                  onChange={e => updateItem(activeItem, { cost: e.target.value })}
                  min="0" step="0.01"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all" />
              </div>

              {/* Performed by */}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Performed by</label>
                <div className="flex gap-2">
                  {(['owner', 'shop'] as const).map(t => (
                    <button key={t} type="button"
                      onClick={() => updateItem(activeItem, { performed_by: t })}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${
                        items[activeItem].performed_by === t
                          ? t === 'owner' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' : 'bg-green-500/20 text-green-300 border border-green-500/40'
                          : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
                      }`}
                    >{t === 'owner' ? '🔧 Owner' : '🏪 Shop'}</button>
                  ))}
                </div>
              </div>

              {/* Shop fields */}
              {items[activeItem].performed_by === 'shop' && (
                <div className="space-y-3">
                  <input type="text" placeholder="Shop name" value={items[activeItem].shop_name}
                    onChange={e => updateItem(activeItem, { shop_name: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all" />
                  <input type="text" placeholder="Location (optional)" value={items[activeItem].shop_location}
                    onChange={e => updateItem(activeItem, { shop_location: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all" />
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1.5">Notes (optional)</label>
                <textarea placeholder="Parts used, observations…" value={items[activeItem].notes}
                  onChange={e => updateItem(activeItem, { notes: e.target.value })}
                  rows={2}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 transition-all resize-none" />
              </div>

              {/* Receipt picker — mobile only (desktop uses side panel) */}
              {receipts.length > 0 && (
                <div className="lg:hidden">
                  <label className="block text-sm font-medium text-zinc-400 mb-2">Receipt</label>
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                    <button
                      onClick={() => updateItem(activeItem, { receiptIdx: null })}
                      className={`shrink-0 w-14 h-14 rounded-xl border-2 flex items-center justify-center text-xs transition-colors ${
                        items[activeItem].receiptIdx === null ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-zinc-700 text-zinc-600'
                      }`}
                    >None</button>
                    {receipts.map((r, i) => (
                      <button key={i} onClick={() => updateItem(activeItem, { receiptIdx: i })}
                        className={`shrink-0 w-14 h-14 rounded-xl border-2 overflow-hidden transition-all ${
                          items[activeItem].receiptIdx === i ? 'border-amber-500' : 'border-zinc-700'
                        }`}
                      >
                        {r.preview
                          ? <img src={r.preview} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full bg-zinc-800 flex items-center justify-center"><Image size={16} className="text-zinc-500" /></div>
                        }
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Desktop receipt side panel */}
            {receipts.length > 0 && (
              <div className="hidden lg:flex flex-col w-64 xl:w-80 border-l border-zinc-800 overflow-y-auto p-4 gap-4 shrink-0">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide shrink-0">Receipts</p>
                {receipts.map((r, i) => (
                  <div key={i} className="space-y-2 shrink-0">
                    {r.preview ? (
                      <img src={r.preview} alt="Receipt" className="w-full rounded-xl object-contain max-h-64 bg-zinc-800" />
                    ) : (
                      <div className="w-full h-32 bg-zinc-800 rounded-xl flex flex-col items-center justify-center gap-2">
                        <Image size={24} className="text-zinc-500" />
                        <span className="text-zinc-500 text-xs">PDF</span>
                      </div>
                    )}
                    <button
                      onClick={() => updateItem(activeItem, { receiptIdx: items[activeItem].receiptIdx === i ? null : i })}
                      className={`w-full py-2 rounded-xl text-sm font-medium transition-colors ${
                        items[activeItem].receiptIdx === i
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                          : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700'
                      }`}
                    >
                      {items[activeItem].receiptIdx === i ? '✓ Selected' : 'Use for this item'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Footer buttons */}
          <div className="px-5 pb-5 pt-3 shrink-0 border-t border-zinc-800 flex gap-3">
            {step === 'receipts' && (
              <>
                <button onClick={onClose} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Cancel</button>
                <button onClick={() => setStep('count')} className="flex-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2">
                  {receipts.length === 0 ? 'Skip' : 'Next'} <ChevronRight size={16} />
                </button>
              </>
            )}

            {step === 'count' && (
              <>
                <button onClick={() => setStep('receipts')} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors">Back</button>
                <button
                  onClick={buildItems}
                  disabled={totalItems === 0}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2"
                >
                  Next <ChevronRight size={16} />
                </button>
              </>
            )}

            {step === 'items' && (
              <>
                {activeItem < totalItems - 1 ? (
                  <>
                    <button onClick={() => setActiveItem(activeItem + 1)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors flex items-center justify-center gap-2">
                      Next Item <ChevronRight size={16} />
                    </button>
                    <button onClick={handleSave} disabled={saving} className="flex-1 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-300 font-medium rounded-2xl py-3 transition-colors text-sm">
                      {saving ? 'Saving…' : 'Save All'}
                    </button>
                  </>
                ) : (
                  <>
                    {activeItem > 0 && (
                      <button onClick={() => setActiveItem(activeItem - 1)} className="w-12 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors flex items-center justify-center">
                        <ChevronLeft size={18} />
                      </button>
                    )}
                    <button onClick={handleSave} disabled={saving} className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-zinc-950 font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2">
                      {saving ? <div className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" /> : <Check size={16} />}
                      {saving ? 'Saving…' : 'Save All'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Crop modal (z above the flow modal) */}
      {cropFile && (
        <ImageCropModal
          file={cropFile}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropFile(null)}
        />
      )}
    </>
  )
}
