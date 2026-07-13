'use client'

import { useState, useRef, useEffect } from 'react'
import { format, parseISO, differenceInDays } from 'date-fns'
import { X, Plus, Image, ChevronLeft, ChevronRight, Check, Wrench, Package, Tag, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { withRetry, withTimeout } from '@/lib/recover'
import type { Vehicle, ServiceCategory, Product } from '@/lib/types'
import dynamic from 'next/dynamic'

const ImageCropModal = dynamic(() => import('./ImageCropModal'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────
interface ReceiptDraft { file: File; preview: string }

interface ProductLink { id: string; product_id: string; label: string; url: string }
interface ProductWithLinks extends Product { links: ProductLink[]; categoryIds: string[] }

interface ItemDraft {
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
  selectedProductIds: string[]
}

interface NewProductDraft { name: string; brand: string; url: string }

type Step = 'receipts' | 'count' | 'items'
interface OdoReading { date: string; odo: number }

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
    return Math.round(before.odo + (after.odo - before.odo) * differenceInDays(target, parseISO(before.date)) / totalDays)
  }
  if (before) {
    const daysToBefore = differenceInDays(new Date(), target)
    return Math.max(0, Math.round(before.odo - (milesPerMonth / 30) * daysToBefore))
  }
  return null
}

const TODAY = format(new Date(), 'yyyy-MM-dd')

function emptyItem(defaultDate: string, defaultOdo: string): ItemDraft {
  return {
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
    selectedProductIds: [],
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AddServiceFlow({ vehicle, categories, historicalReadings = [], milesPerMonth = 1250, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('receipts')
  const [receipts, setReceipts] = useState<ReceiptDraft[]>([])
  const [previewReceiptIdx, setPreviewReceiptIdx] = useState(0)
  const [cropFile, setCropFile] = useState<File | null>(null)

  const [sessionDate, setSessionDate] = useState(TODAY)
  const [sessionOdo, setSessionOdo] = useState(String(vehicle.odometer))
  const [serviceCount, setServiceCount] = useState(1)

  const [items, setItems] = useState<ItemDraft[]>([])
  const [activeItem, setActiveItem] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Stable ids so a retry after a failed save re-writes the SAME rows (upsert) —
  // it can never create duplicates. Reset only after a clean, complete save.
  const saveIds = useRef<{ sessionId: string; logIds: string[]; receiptPaths: string[] } | null>(null)

  // Library products
  const [libraryProducts, setLibraryProducts] = useState<ProductWithLinks[]>([])
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [newProduct, setNewProduct] = useState<NewProductDraft>({ name: '', brand: '', url: '' })
  const [savingProduct, setSavingProduct] = useState(false)
  const [productError, setProductError] = useState<string | null>(null)
  const productId = useRef<string | null>(null)

  // Load product library on mount
  useEffect(() => {
    if (!vehicle) return
    Promise.all([
      supabase.from('products').select('*').eq('vehicle_id', vehicle.id).order('name'),
      supabase.from('product_links').select('*'),
      supabase.from('product_category_links').select('*'),
    ]).then(([{ data: prods }, { data: links }, { data: catLinks }]) => {
      if (!prods) return
      setLibraryProducts(prods.map(p => ({
        ...p,
        links: (links ?? []).filter(l => l.product_id === p.id),
        categoryIds: (catLinks ?? []).filter(cl => cl.product_id === p.id).map(cl => cl.category_id),
      })))
    }).catch(() => {}) // graceful if tables don't exist yet
  }, [vehicle])

  // ─── Receipts step ──────────────────────────────────────────────────────────
  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.type.startsWith('image/')) { setCropFile(file) }
    else { addReceiptDirect(file) }
  }

  function addReceiptDirect(file: File) {
    const preview = URL.createObjectURL(file)
    setReceipts(r => { setPreviewReceiptIdx(r.length); return [...r, { file, preview }] })
  }

  function handleCropConfirm(compressed: File) {
    const preview = URL.createObjectURL(compressed)
    setReceipts(r => { setPreviewReceiptIdx(r.length); return [...r, { file: compressed, preview }] })
    setCropFile(null)
  }

  function removeReceipt(idx: number) {
    setReceipts(prev => {
      URL.revokeObjectURL(prev[idx].preview)
      const next = prev.filter((_, i) => i !== idx)
      setPreviewReceiptIdx(Math.max(0, Math.min(previewReceiptIdx, next.length - 1)))
      setItems(items => items.map(it => ({
        ...it,
        receiptIdx: it.receiptIdx === idx ? null : it.receiptIdx != null && it.receiptIdx > idx ? it.receiptIdx - 1 : it.receiptIdx,
      })))
      return next
    })
  }

  function handleSessionDateChange(date: string) {
    setSessionDate(date)
    if (date < TODAY && historicalReadings.length > 0) {
      const est = estimateOdoForDate(date, historicalReadings, milesPerMonth)
      if (est != null && est > 0) setSessionOdo(String(est))
    }
  }

  function buildItems() {
    setItems(Array.from({ length: serviceCount }, () => emptyItem(sessionDate, sessionOdo)))
    setActiveItem(0)
    setStep('items')
  }

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  function toggleProduct(itemIdx: number, productId: string) {
    setItems(prev => prev.map((it, i) => {
      if (i !== itemIdx) return it
      const ids = it.selectedProductIds.includes(productId)
        ? it.selectedProductIds.filter(id => id !== productId)
        : [...it.selectedProductIds, productId]
      return { ...it, selectedProductIds: ids }
    }))
  }

  async function handleAddProductToLibrary() {
    if (!user || !newProduct.name.trim()) return
    setSavingProduct(true)
    setProductError(null)
    // Stable id so retrying re-writes the same product row instead of duplicating it.
    if (!productId.current) productId.current = crypto.randomUUID()
    const pid = productId.current
    try {
      const { error: pErr } = await withRetry(() => withTimeout(supabase.from('products').upsert({
        id: pid,
        user_id: user.id,
        vehicle_id: vehicle.id,
        name: newProduct.name.trim(),
        brand: newProduct.brand.trim() || null,
      }), 9000), 2, 800)
      if (pErr) throw new Error(pErr.message)

      if (newProduct.url.trim()) {
        // delete-then-insert keeps the link set idempotent across retries
        await withTimeout(supabase.from('product_links').delete().eq('product_id', pid), 9000)
        await withRetry(() => withTimeout(supabase.from('product_links').insert({ product_id: pid, label: 'Buy', url: newProduct.url.trim() }), 9000), 2, 800)
      }

      const catId = items[activeItem]?.category_id
      if (catId) {
        try {
          await withTimeout(supabase.from('product_category_links').delete().eq('product_id', pid).eq('category_id', catId), 9000)
          await withTimeout(supabase.from('product_category_links').insert({ product_id: pid, category_id: catId }), 9000)
        } catch { /* join table optional */ }
      }

      // Reload library and auto-select the new product
      const [{ data: prods }, { data: links }, { data: catLinks }] = await withRetry(() => withTimeout(Promise.all([
        supabase.from('products').select('*').eq('vehicle_id', vehicle.id).order('name'),
        supabase.from('product_links').select('*'),
        supabase.from('product_category_links').select('*'),
      ]), 9000), 2, 800)
      const updated: ProductWithLinks[] = (prods ?? []).map(p => ({
        ...p,
        links: (links ?? []).filter(l => l.product_id === p.id),
        categoryIds: (catLinks ?? []).filter(cl => cl.product_id === p.id).map(cl => cl.category_id),
      }))
      setLibraryProducts(updated)
      toggleProduct(activeItem, pid)

      // Success — clear the form and free the id for the next product.
      productId.current = null
      setNewProduct({ name: '', brand: '', url: '' })
      setShowAddProduct(false)
    } catch {
      // Keep the form and the id so tapping "Add" again re-writes the same product.
      setProductError('Couldn’t reach the database — your entry is kept. Tap Add to try again.')
    } finally {
      setSavingProduct(false)
    }
  }

  const maintenanceCats = categories.filter(c => c.category_type === 'maintenance')

  async function handleSave() {
    if (!user) return
    setSaving(true)
    setError(null)
    // Stable ids for this save so a retry re-writes the SAME rows (idempotent) —
    // this is exactly what stops "it added one, then duplicated on retry".
    if (!saveIds.current) {
      saveIds.current = {
        sessionId: crypto.randomUUID(),
        logIds: items.map(() => crypto.randomUUID()),
        receiptPaths: receipts.map(r => `${user.id}/${crypto.randomUUID()}.${r.file.name.split('.').pop() ?? 'jpg'}`),
      }
    }
    const ids = saveIds.current

    try {
      // Upload receipts to their stable paths (upsert overwrites on retry, so no
      // orphaned duplicate files). Bigger timeout — images can be large.
      const uploadedPaths: (string | null)[] = await Promise.all(
        receipts.map(async (r, i) => {
          const path = ids.receiptPaths[i]
          const { error } = await withTimeout(
            supabase.storage.from('receipts').upload(path, r.file, { upsert: true }),
            20000
          )
          return error ? null : path
        })
      )

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx]
        const cat = maintenanceCats.find(c => c.id === item.category_id)
        const serviceType = item.record_type === 'maintenance'
          ? (cat?.name ?? item.service_type.trim())
          : item.service_type.trim()
        const logId = ids.logIds[idx]

        const { error: logErr } = await withRetry(() => withTimeout(supabase.from('service_logs').upsert({
          id: logId,
          user_id: user.id,
          vehicle_id: vehicle.id,
          session_id: ids.sessionId,
          service_type: serviceType || 'Service',
          category_id: item.category_id || null,
          record_type: item.record_type,
          performed_by: item.performed_by,
          shop_name: item.performed_by === 'shop' ? (item.shop_name.trim() || null) : null,
          shop_location: item.performed_by === 'shop' ? (item.shop_location.trim() || null) : null,
          receipt_url: item.receiptIdx != null ? (uploadedPaths[item.receiptIdx] ?? null) : null,
          date: item.date,
          odometer: parseInt(item.odometer) || vehicle.odometer,
          cost: item.cost ? parseFloat(item.cost) : null,
          notes: item.notes.trim() || null,
        }), 9000), 2, 800)
        if (logErr) throw new Error(logErr.message)

        // Rewrite this log's product links idempotently (clear then re-add).
        try {
          await withTimeout(supabase.from('service_log_products').delete().eq('log_id', logId), 9000)
          if (item.selectedProductIds.length > 0) {
            await withRetry(() => withTimeout(supabase.from('service_log_products').insert(
              item.selectedProductIds.map(pid => ({ log_id: logId, product_id: pid }))
            ), 9000), 2, 800)
          }
        } catch { /* join table optional */ }
      }

      const maxOdo = Math.max(...items.map(i => parseInt(i.odometer) || 0))
      if (maxOdo > vehicle.odometer) {
        await withRetry(() => withTimeout(supabase.from('vehicles').update({ odometer: maxOdo }).eq('id', vehicle.id), 9000), 2, 800)
      }

      // Clean save — free the ids and hand back to the caller.
      saveIds.current = null
      onSaved()
    } catch {
      // Nothing is lost: the modal stays open with everything filled in, and the
      // stable ids mean tapping Save again finishes the job without duplicating.
      setError('Couldn’t reach the database — nothing was lost. Tap Save to try again.')
    } finally {
      setSaving(false)
    }
  }

  const currentItem = items[activeItem]
  const currentCatId = currentItem?.category_id ?? ''
  const suggestedProducts = libraryProducts.filter(p =>
    currentCatId ? p.categoryIds.includes(currentCatId) : true
  )

  // ─── Render ─────────────────────────────────────────────────────────────────
  const isWide = step === 'items' && receipts.length > 0

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className={`bg-surface border border-border rounded-t-3xl sm:rounded-3xl w-full flex flex-col overflow-hidden ${isWide ? 'max-h-screen sm:max-h-[95vh] lg:max-w-6xl' : 'max-w-sm max-h-[92vh]'}`}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0 border-b border-border">
            <div className="flex items-center gap-3">
              {step !== 'receipts' && (
                <button onClick={() => setStep(step === 'items' ? 'count' : 'receipts')} className="text-muted hover:text-foreground transition-colors">
                  <ChevronLeft size={20} />
                </button>
              )}
              <div>
                <p className="text-muted text-xs">Step {step === 'receipts' ? 1 : step === 'count' ? 2 : 3} of 3</p>
                <h3 className="font-bold text-foreground">
                  {step === 'receipts' ? 'Attach Receipts' : step === 'count' ? 'Session details' : `Service ${activeItem + 1}${items.length > 1 ? ` of ${items.length}` : ''}`}
                </h3>
              </div>
            </div>
            <button onClick={onClose} className="text-muted hover:text-foreground"><X size={20} /></button>
          </div>

          {/* ── Step 1: Receipts ─────────────────────────────────────────────── */}
          {step === 'receipts' && (
            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {receipts.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {receipts.map((r, i) => (
                    <div key={i} className="relative aspect-square">
                      {r.file.type === 'application/pdf' ? (
                        <iframe src={r.preview} title="PDF" className="w-full h-full rounded-xl pointer-events-none" />
                      ) : (
                        <img src={r.preview} alt="" className="w-full h-full object-cover rounded-xl bg-surface-2" />
                      )}
                      <button onClick={() => removeReceipt(i)} className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center">
                        <X size={10} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleFileSelect} className="hidden" />
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 w-full border-2 border-dashed border-border-strong hover:border-accent/40 rounded-xl px-4 py-3 text-muted hover:text-accent text-sm transition-colors">
                <Plus size={15} /> Add Receipt (photo, scan, or PDF)
              </button>
              <p className="text-faint text-xs text-center">You can add multiple receipts. Each service can reference one.</p>
            </div>
          )}

          {/* ── Step 2: Count ────────────────────────────────────────────────── */}
          {step === 'count' && (
            <div className="overflow-y-auto flex-1 p-5 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Date</label>
                  <input type="date" value={sessionDate} onChange={e => handleSessionDateChange(e.target.value)}
                    className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-3 text-foreground focus:outline-none focus:border-accent/70 transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Odometer (mi)</label>
                  <input type="number" value={sessionOdo} onChange={e => setSessionOdo(e.target.value)} min="0"
                    className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted mb-3">Services performed</label>
                <div className="flex items-center gap-4">
                  <Wrench size={18} className="text-accent" />
                  <button onClick={() => setServiceCount(Math.max(1, serviceCount - 1))} className="w-9 h-9 bg-surface-2 rounded-xl text-foreground text-lg font-bold hover:bg-surface-2 transition-colors">−</button>
                  <span className="text-foreground font-bold text-xl w-6 text-center">{serviceCount}</span>
                  <button onClick={() => setServiceCount(serviceCount + 1)} className="w-9 h-9 bg-surface-2 rounded-xl text-foreground text-lg font-bold hover:bg-surface-2 transition-colors">+</button>
                </div>
                <p className="text-faint text-xs mt-2">Products used will be added within each service step.</p>
              </div>
            </div>
          )}

          {/* ── Step 3: Items (full layout with receipt preview) ─────────────── */}
          {step === 'items' && currentItem && (
            <div className="flex flex-1 overflow-hidden">

              {/* Form panel */}
              <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 overflow-y-auto flex flex-col">
                <div className="flex-1 p-5 space-y-4">

                  {/* Item dots */}
                  {items.length > 1 && (
                    <div className="flex items-center gap-1.5 justify-center">
                      {items.map((_, i) => (
                        <button key={i} onClick={() => setActiveItem(i)}
                          className={`rounded-full transition-all ${i === activeItem ? 'w-4 h-2 bg-accent' : 'w-2 h-2 bg-surface-2'}`} />
                      ))}
                    </div>
                  )}

                  {/* Maintenance/Repair */}
                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">Type</label>
                    <div className="flex gap-2">
                      {(['maintenance', 'repair'] as const).map(t => (
                        <button key={t} type="button" onClick={() => updateItem(activeItem, { record_type: t, category_id: '', service_type: '' })}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${
                            currentItem.record_type === t
                              ? t === 'maintenance' ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-warn/20 text-warn border border-warn/40'
                              : 'bg-surface-2 text-muted border border-border-strong'
                          }`}>{t}</button>
                      ))}
                    </div>
                  </div>

                  {/* Category / description */}
                  {currentItem.record_type === 'maintenance' ? (
                    <div>
                      <label className="block text-sm font-medium text-muted mb-1.5">Sub-category</label>
                      <select value={currentItem.category_id}
                        onChange={e => { const cat = maintenanceCats.find(c => c.id === e.target.value); updateItem(activeItem, { category_id: e.target.value, service_type: cat?.name ?? '', selectedProductIds: [] }) }}
                        className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent/70 transition-all appearance-none">
                        <option value="">Select category…</option>
                        {maintenanceCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-muted mb-1.5">Description</label>
                      <input type="text" placeholder="e.g. Replaced front struts" value={currentItem.service_type}
                        onChange={e => updateItem(activeItem, { service_type: e.target.value })}
                        className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                    </div>
                  )}

                  {/* Date + Odometer */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-muted mb-1.5">Date</label>
                      <input type="date" value={currentItem.date} onChange={e => updateItem(activeItem, { date: e.target.value })}
                        className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-3 text-foreground focus:outline-none focus:border-accent/70 transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-muted mb-1.5">Odometer</label>
                      <input type="number" value={currentItem.odometer} onChange={e => updateItem(activeItem, { odometer: e.target.value })} min="0"
                        className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                    </div>
                  </div>

                  {/* Cost */}
                  <div>
                    <label className="block text-sm font-medium text-muted mb-1.5">Cost ($)</label>
                    <input type="number" placeholder="0.00" value={currentItem.cost} onChange={e => updateItem(activeItem, { cost: e.target.value })} min="0" step="0.01"
                      className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                  </div>

                  {/* Performed by */}
                  <div>
                    <label className="block text-sm font-medium text-muted mb-2">Performed by</label>
                    <div className="flex gap-2">
                      {(['owner', 'shop'] as const).map(t => (
                        <button key={t} type="button" onClick={() => updateItem(activeItem, { performed_by: t })}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                            currentItem.performed_by === t
                              ? t === 'owner' ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-success/20 text-success border border-success/40'
                              : 'bg-surface-2 text-muted border border-border-strong'
                          }`}>{t === 'owner' ? '🔧 Owner' : '🏪 Shop'}</button>
                      ))}
                    </div>
                  </div>

                  {currentItem.performed_by === 'shop' && (
                    <div className="space-y-3">
                      <input type="text" placeholder="Shop name" value={currentItem.shop_name} onChange={e => updateItem(activeItem, { shop_name: e.target.value })}
                        className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                      <input type="text" placeholder="Location (optional)" value={currentItem.shop_location} onChange={e => updateItem(activeItem, { shop_location: e.target.value })}
                        className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all" />
                    </div>
                  )}

                  {/* Notes */}
                  <div>
                    <label className="block text-sm font-medium text-muted mb-1.5">Notes (optional)</label>
                    <textarea placeholder="Parts used, observations…" value={currentItem.notes} onChange={e => updateItem(activeItem, { notes: e.target.value })} rows={2}
                      className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 transition-all resize-none" />
                  </div>

                  {/* ── Products section ─────────────────────────────────── */}
                  <div className="border-t border-border pt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Package size={14} className="text-muted" />
                      <p className="text-sm font-medium text-muted">Parts / Products used</p>
                    </div>

                    {suggestedProducts.length > 0 ? (
                      <div className="space-y-2 mb-3">
                        {suggestedProducts.map(p => {
                          const selected = currentItem.selectedProductIds.includes(p.id)
                          return (
                            <button key={p.id} type="button" onClick={() => toggleProduct(activeItem, p.id)}
                              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors border ${
                                selected ? 'bg-accent/10 border-accent/30' : 'bg-surface-2/50 border-border hover:border-border-strong'
                              }`}>
                              <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${selected ? 'bg-accent border-accent' : 'border-border-strong'}`}>
                                {selected && <Check size={10} className="text-white" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium truncate ${selected ? 'text-accent' : 'text-foreground'}`}>{p.name}</p>
                                {p.brand && <p className="text-muted text-xs">{p.brand}</p>}
                              </div>
                              {p.links[0] && (
                                <a href={p.links[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                                  className="text-faint hover:text-accent shrink-0 transition-colors"><ExternalLink size={12} /></a>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-faint text-xs mb-3">
                        {libraryProducts.length === 0
                          ? 'No products in library yet.'
                          : 'No products linked to this service category.'}
                      </p>
                    )}

                    {/* Add new product */}
                    {!showAddProduct ? (
                      <button type="button" onClick={() => setShowAddProduct(true)}
                        className="flex items-center gap-1.5 text-muted hover:text-accent text-sm transition-colors">
                        <Plus size={13} /> Add new product to library
                      </button>
                    ) : (
                      <div className="bg-surface-2/60 border border-border-strong rounded-xl p-3 space-y-2">
                        <p className="text-xs font-semibold text-muted">New product</p>
                        <input type="text" placeholder="Product name *" value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))}
                          className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all" />
                        <input type="text" placeholder="Brand / Company" value={newProduct.brand} onChange={e => setNewProduct(p => ({ ...p, brand: e.target.value }))}
                          className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all" />
                        <input type="url" placeholder="Buy link (optional)" value={newProduct.url} onChange={e => setNewProduct(p => ({ ...p, url: e.target.value }))}
                          className="w-full bg-surface border border-border-strong rounded-lg px-3 py-2 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all" />
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setShowAddProduct(false)} className="flex-1 py-2 bg-surface-2 hover:bg-faint text-foreground text-xs font-medium rounded-lg transition-colors">Cancel</button>
                          <button type="button" onClick={handleAddProductToLibrary} disabled={!newProduct.name.trim() || savingProduct}
                            className="flex-1 py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors">
                            {savingProduct ? 'Adding…' : 'Add & Select'}
                          </button>
                        </div>
                        {productError && <p className="text-danger text-xs">{productError}</p>}
                      </div>
                    )}
                  </div>

                  {/* Receipt picker (mobile only) */}
                  {receipts.length > 0 && (
                    <div className="lg:hidden border-t border-border pt-4">
                      <label className="block text-sm font-medium text-muted mb-2">Receipt for this service</label>
                      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
                        <button onClick={() => updateItem(activeItem, { receiptIdx: null })}
                          className={`shrink-0 w-14 h-14 rounded-xl border-2 flex items-center justify-center text-xs transition-colors ${
                            currentItem.receiptIdx === null ? 'border-accent bg-accent/10 text-accent' : 'border-border-strong text-faint'
                          }`}>None</button>
                        {receipts.map((r, i) => (
                          <button key={i} onClick={() => updateItem(activeItem, { receiptIdx: i })}
                            className={`shrink-0 w-14 h-14 rounded-xl border-2 overflow-hidden transition-all ${currentItem.receiptIdx === i ? 'border-accent' : 'border-border-strong'}`}>
                            {r.file.type === 'application/pdf'
                              ? <iframe src={r.preview} title="PDF" className="w-full h-full pointer-events-none" />
                              : <img src={r.preview} alt="" className="w-full h-full object-cover" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Receipt preview panel (desktop — takes remaining space) */}
              {receipts.length > 0 && (
                <div className="hidden lg:flex flex-1 flex-col border-l border-border overflow-hidden bg-background">
                  {/* Switcher */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0 flex-wrap">
                    {receipts.map((r, i) => (
                      <button key={i}
                        onClick={() => setPreviewReceiptIdx(i)}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                          previewReceiptIdx === i ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong hover:border-border-strong'
                        }`}>
                        <Image size={11} />Receipt {i + 1}
                      </button>
                    ))}
                    {/* Attach toggle */}
                    <button
                      onClick={() => updateItem(activeItem, {
                        receiptIdx: currentItem.receiptIdx === previewReceiptIdx ? null : previewReceiptIdx
                      })}
                      className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                        currentItem.receiptIdx === previewReceiptIdx
                          ? 'bg-success/15 text-success border-success/30'
                          : 'bg-surface-2 text-muted border-border-strong hover:border-border-strong'
                      }`}>
                      {currentItem.receiptIdx === previewReceiptIdx ? <Check size={11} /> : null}
                      {currentItem.receiptIdx === previewReceiptIdx ? 'Attached to this service' : 'Attach to this service'}
                    </button>
                  </div>

                  {/* Receipt display */}
                  <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
                    {receipts[previewReceiptIdx]?.file.type === 'application/pdf' ? (
                      <iframe src={receipts[previewReceiptIdx].preview} title="Receipt PDF" className="w-full h-full border-0 rounded-xl" />
                    ) : (
                      <img src={receipts[previewReceiptIdx]?.preview} alt="Receipt" className="max-w-full max-h-full object-contain rounded-xl" />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="px-5 pt-3 shrink-0">
              <p className="text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">{error}</p>
            </div>
          )}
          {/* Footer */}
          <div className="px-5 pb-5 pt-3 shrink-0 border-t border-border flex gap-3">
            {step === 'receipts' && (
              <>
                <button onClick={onClose} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
                <button onClick={() => setStep('count')} className="flex-1 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2">
                  {receipts.length === 0 ? 'Skip' : 'Next'} <ChevronRight size={16} />
                </button>
              </>
            )}
            {step === 'count' && (
              <>
                <button onClick={() => setStep('receipts')} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors">Back</button>
                <button onClick={buildItems} className="flex-1 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2">
                  Next <ChevronRight size={16} />
                </button>
              </>
            )}
            {step === 'items' && (
              <>
                {activeItem < items.length - 1 ? (
                  <>
                    <button onClick={() => setActiveItem(activeItem + 1)} className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors flex items-center justify-center gap-2">
                      Next Service <ChevronRight size={16} />
                    </button>
                    <button onClick={handleSave} disabled={saving} className="flex-1 bg-surface-2 hover:bg-faint disabled:opacity-40 text-foreground font-medium rounded-2xl py-3 transition-colors text-sm">
                      {saving ? 'Saving…' : 'Save All'}
                    </button>
                  </>
                ) : (
                  <>
                    {activeItem > 0 && (
                      <button onClick={() => setActiveItem(activeItem - 1)} className="w-12 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors flex items-center justify-center">
                        <ChevronLeft size={18} />
                      </button>
                    )}
                    <button onClick={handleSave} disabled={saving} className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors flex items-center justify-center gap-2">
                      {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check size={16} />}
                      {saving ? 'Saving…' : 'Save All'}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {cropFile && <ImageCropModal file={cropFile} onConfirm={handleCropConfirm} onCancel={() => setCropFile(null)} />}
    </>
  )
}
