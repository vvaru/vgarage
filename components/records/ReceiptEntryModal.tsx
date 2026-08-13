'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  X, Plus, Trash2, Receipt as ReceiptIcon, Image as ImageIcon, Wrench, Package,
  ChevronUp, ChevronDown, Link2, SlidersHorizontal, ExternalLink,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { withRetry, withTimeout } from '@/lib/recover'
import ReceiptViewer from '@/components/ui/ReceiptViewer'
import ServiceFilterPanel from '@/components/service/ServiceFilterPanel'
import { applyServiceFilter, EMPTY_FILTER, isFilterActive, type ServiceFilterState } from '@/lib/serviceFilter'
import { UNIT_GROUPS, guessUnit, fmtQty } from '@/lib/units'
import type { Product, Receipt, ReceiptItem, ServiceCategory, ServiceLog, ServiceProductUsage } from '@/lib/types'
import type { ProductStock } from '@/lib/inventory'

const num = (s: string): number | null => {
  const n = parseFloat(s)
  return s.trim() !== '' && !isNaN(n) ? n : null
}

type ProductU = Product & { unit?: string }

// A past service receipt being pulled in (image already in storage).
export interface PastReceipt {
  logId: string
  imagePath: string
  date: string | null
  label: string
}

interface LineDraft {
  key: string
  itemId: string | null
  productId: string
  newName: string
  newBrand: string
  unit: string
  unitTouched: boolean
  qty: string
  unitPrice: string
  leftNow: string
}

const emptyLine = (): LineDraft => ({
  key: crypto.randomUUID(), itemId: null, productId: '', newName: '', newBrand: '',
  unit: 'each', unitTouched: false, qty: '', unitPrice: '', leftNow: '',
})

interface ServiceDraft {
  key: string
  linkedLogId: string | null   // set = attach to an existing record instead of creating one
  categoryId: string
  serviceType: string
  performedBy: 'shop' | 'owner'
  cost: string
  shopEquivalent: string       // DIY only — what a shop would have charged
  date: string
  odometer: string
  notes: string
}

const emptyService = (date: string): ServiceDraft => ({
  key: crypto.randomUUID(), linkedLogId: null, categoryId: '', serviceType: '',
  performedBy: 'shop', cost: '', shopEquivalent: '', date, odometer: '', notes: '',
})

interface Props {
  /** 'new' = blank receipt, 'past' = complete an old service image, 'edit' = existing receipt */
  mode: 'new' | 'past' | 'edit'
  receipt?: Receipt
  past?: PastReceipt
  existingItems?: ReceiptItem[]
  existingLogIds?: string[]
  products: ProductU[]
  categories: ServiceCategory[]
  logs: ServiceLog[]
  usage?: ServiceProductUsage[]
  stock?: Map<string, ProductStock>
  onClose: () => void
  onSaved: () => void
  onOpenService?: (logId: string) => void
  onGoToServices?: () => void
}

export default function ReceiptEntryModal({
  mode, receipt, past, existingItems = [], existingLogIds = [],
  products, categories, logs, usage = [], stock,
  onClose, onSaved, onOpenService, onGoToServices,
}: Props) {
  const { user } = useAuth()
  const { vehicle } = useVehicle()
  const fileRef = useRef<HTMLInputElement>(null)

  const initialDate = receipt?.date ?? past?.date ?? format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(initialDate)
  const [store, setStore] = useState(receipt?.store ?? '')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const [serviceOnly, setServiceOnly] = useState(Boolean(receipt?.no_products))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)   // service key choosing an existing record
  const [filter, setFilter] = useState<ServiceFilterState>(EMPTY_FILTER)
  const [showFilters, setShowFilters] = useState(false)

  const [lines, setLines] = useState<LineDraft[]>(() =>
    existingItems.length > 0
      ? existingItems.map(it => ({
          ...emptyLine(),
          key: it.id, itemId: it.id, productId: it.product_id,
          unit: products.find(p => p.id === it.product_id)?.unit ?? 'each',
          unitTouched: true,
          qty: String(it.qty),
          unitPrice: it.unit_cost == null ? '' : String(it.unit_cost),
        }))
      : [emptyLine()],
  )
  const [services, setServices] = useState<ServiceDraft[]>(() =>
    existingLogIds.map(id => {
      const l = logs.find(x => x.id === id)
      return {
        ...emptyService(initialDate),
        key: id,
        linkedLogId: id,
        serviceType: l?.service_type ?? '',
        performedBy: (l?.performed_by === 'owner' ? 'owner' : 'shop') as 'shop' | 'owner',
        cost: l?.cost == null ? '' : String(l.cost),
        date: l?.date ?? initialDate,
      }
    }),
  )
  const [removedItems, setRemovedItems] = useState<string[]>([])

  const saveIds = useRef<{ receiptId: string; lines: Record<string, string>; logs: Record<string, string> } | null>(null)

  const existingImage = mode === 'past' ? past?.imagePath : receipt?.image_path ?? null
  const previewIsPdf = imageFile?.type === 'application/pdf'
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview) }, [imagePreview])

  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const logById = useMemo(() => new Map(logs.map(l => [l.id, l])), [logs])
  const allTypes = useMemo(() => [...new Set(logs.map(l => l.service_type))].sort(), [logs])
  const filteredLogs = useMemo(() => applyServiceFilter(logs, filter).slice(0, 40), [logs, filter])

  // Lines already drawn from can't be pulled out without corrupting a service's cost.
  const consumedItemIds = useMemo(() => {
    const ids = new Set(existingItems.map(i => i.id))
    const out = new Set<string>()
    for (const u of usage) if (u.receipt_item_id && ids.has(u.receipt_item_id)) out.add(u.receipt_item_id)
    return out
  }, [usage, existingItems])

  const partsTotal = lines.reduce((s, l) => s + (num(l.qty) ?? 0) * (num(l.unitPrice) ?? 0), 0)
  const servicesTotal = services.reduce((s, x) => s + (num(x.cost) ?? 0), 0)
  const grandTotal = (serviceOnly ? 0 : partsTotal) + servicesTotal

  // Shop labour on the receipt itself. A DIY record merely links to it.
  const carriesShopService = services.some(s => s.performedBy === 'shop')

  // Services this receipt is ALREADY tied to before anything is typed: the record
  // a past receipt was lifted from, plus any existing attachments when editing.
  const linkedLogIds = useMemo(() => {
    const s = new Set(existingLogIds)
    if (mode === 'past' && past?.logId) s.add(past.logId)
    return [...s]
  }, [existingLogIds, mode, past?.logId])
  const linkedShop = linkedLogIds.some(id => logById.get(id)?.performed_by === 'shop')

  const hasAnyProduct = lines.some(l => (l.productId || l.newName.trim()) && num(l.qty) != null)
  const hasImage = Boolean(imagePreview || existingImage)
  // A past or existing receipt is always saveable — it already has an origin and an
  // image. Only a brand-new one needs something on it before Save means anything.
  const canSave = mode !== 'new' || hasImage || hasAnyProduct || services.length > 0

  function patchLine(key: string, patch: Partial<LineDraft>) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  }
  function patchService(key: string, patch: Partial<ServiceDraft>) {
    setServices(prev => prev.map(s => s.key === key ? { ...s, ...patch } : s))
  }
  function pickProduct(key: string, productId: string) {
    patchLine(key, { productId, unit: productById.get(productId)?.unit ?? 'each' })
  }
  function nameLine(l: LineDraft, newName: string) {
    patchLine(l.key, l.unitTouched ? { newName } : { newName, unit: guessUnit(newName) })
  }
  function removeLine(l: LineDraft) {
    if (l.itemId && consumedItemIds.has(l.itemId)) return
    if (l.itemId) setRemovedItems(prev => [...prev, l.itemId!])
    setLines(prev => prev.filter(x => x.key !== l.key))
  }
  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setImageFile(f); setImagePreview(URL.createObjectURL(f)); e.target.value = ''
  }
  function linkExisting(serviceKey: string, log: ServiceLog) {
    patchService(serviceKey, {
      linkedLogId: log.id,
      serviceType: log.service_type,
      performedBy: log.performed_by === 'owner' ? 'owner' : 'shop',
      cost: log.cost == null ? '' : String(log.cost),
      date: log.date,
      odometer: String(log.odometer),
      categoryId: log.category_id ?? '',
    })
    setPicking(null)
  }

  async function handleSave() {
    if (!user || !vehicle || !canSave) return
    setSaving(true)
    setError(null)
    if (!saveIds.current) {
      saveIds.current = {
        receiptId: receipt?.id ?? crypto.randomUUID(),
        lines: Object.fromEntries(lines.map(l => [l.key, l.itemId ?? crypto.randomUUID()])),
        logs: Object.fromEntries(services.map(s => [s.key, s.linkedLogId ?? crypto.randomUUID()])),
      }
    }
    const ids = saveIds.current

    try {
      // 1) Image — reuse what's already stored, or upload the new pick.
      let imagePath: string | null = existingImage ?? null
      if (imageFile) {
        const ext = imageFile.name.split('.').pop() ?? 'jpg'
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await withTimeout(supabase.storage.from('receipts').upload(path, imageFile, { upsert: true }), 20000)
        if (!upErr) imagePath = path
      }

      // 2) The receipt row.
      const { error: rErr } = await withRetry(() => withTimeout(supabase.from('receipts').upsert({
        id: ids.receiptId, user_id: user.id, date: date || null, store: store.trim() || null,
        image_path: imagePath, no_products: serviceOnly,
        total_cost: grandTotal > 0 ? Math.round(grandTotal * 100) / 100 : null,
      }), 9000), 2, 800)
      if (rErr) throw new Error(rErr.message)

      // 3) Product lines → products + lots.
      for (const id of removedItems) {
        await withTimeout(supabase.from('receipt_items').delete().eq('id', id), 9000)
      }
      if (!serviceOnly) {
        for (const l of lines) {
          const qty = num(l.qty)
          if (!(l.productId || l.newName.trim()) || qty == null) continue
          let pid = l.productId
          if (!pid) {
            pid = ids.lines[l.key]
            const { error: pErr } = await withRetry(() => withTimeout(supabase.from('products').upsert({
              id: pid, user_id: user.id, vehicle_id: null,
              name: l.newName.trim(), brand: l.newBrand.trim() || null, unit: l.unit || 'each',
            }), 9000), 2, 800)
            if (pErr) throw new Error(pErr.message)
          } else {
            const current = productById.get(pid)
            if (current && (current.unit ?? 'each') !== l.unit) {
              await withTimeout(supabase.from('products').update({ unit: l.unit }).eq('id', pid), 9000)
            }
          }

          const { error: iErr } = await withRetry(() => withTimeout(supabase.from('receipt_items').upsert({
            id: ids.lines[l.key], receipt_id: ids.receiptId, product_id: pid,
            qty, unit_cost: num(l.unitPrice),
          }), 9000), 2, 800)
          if (iErr) throw new Error(iErr.message)

          const left = num(l.leftNow)
          if (mode === 'past' && left != null && left < qty) {
            await withTimeout(supabase.from('inventory_adjustments').insert({
              user_id: user.id, product_id: pid, qty_delta: -(qty - left),
              unit_cost: num(l.unitPrice), note: 'Used before inventory tracking', date: date || null,
            }), 9000)
          }
        }
      }

      // 4) Services — create new records, or just attach to the ones picked.
      for (const s of services) {
        const logId = ids.logs[s.key]
        const cat = categories.find(c => c.id === s.categoryId)
        // Date and shop name come from the receipt, so they're never entered twice.
        const fields = {
          service_type: (cat?.name ?? s.serviceType).trim() || 'Service',
          category_id: s.categoryId || null,
          record_type: cat?.category_type ?? 'maintenance',
          performed_by: s.performedBy === 'shop' ? 'shop' : 'owner',
          shop_name: s.performedBy === 'shop' ? (store.trim() || null) : null,
          date: date || s.date,
          odometer: num(s.odometer) ?? vehicle.odometer,
          cost: num(s.cost),
          shop_equivalent_cost: s.performedBy === 'owner' ? num(s.shopEquivalent) : null,
          notes: s.notes.trim() || null,
        }
        if (!s.linkedLogId) {
          const { error: lErr } = await withRetry(() => withTimeout(supabase.from('service_logs').upsert({
            id: logId, user_id: user.id, vehicle_id: vehicle.id, ...fields,
          }), 9000), 2, 800)
          if (lErr) throw new Error(lErr.message)
        } else {
          // Editing a record we're linked to, right here — no separate service UI.
          const { error: uErr } = await withRetry(() => withTimeout(
            supabase.from('service_logs').update(fields).eq('id', logId), 9000), 2, 800)
          if (uErr) throw new Error(uErr.message)
        }
        await withTimeout(supabase.from('service_log_receipts').upsert({ log_id: logId, receipt_id: ids.receiptId }), 9000)
      }

      // 5) A past receipt stays attached to the record it came from.
      if (mode === 'past' && past?.logId) {
        await withTimeout(supabase.from('service_log_receipts').upsert({ log_id: past.logId, receipt_id: ids.receiptId }), 9000)
      }

      saveIds.current = null
      onSaved()
    } catch (e) {
      setError(`Couldn’t save (${e instanceof Error ? e.message : String(e)}). Nothing was lost — tap Save to try again.`)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all'
  const title = mode === 'edit' ? (store.trim() || 'Receipt') : mode === 'past' ? 'Complete receipt details' : 'Add receipt'

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-border rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"><ReceiptIcon size={17} className="text-accent" /></div>
            <div className="min-w-0">
              <h3 className="font-bold text-foreground text-lg truncate">{title}</h3>
              <p className="text-faint text-xs">
                {mode === 'past' ? past?.label : date ? format(parseISO(date), 'MMM d, yyyy') : 'No date'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground shrink-0"><X size={20} /></button>
        </div>

        {/* Mobile scrolls as one column — two independent scroll panes squeeze the
            form to nothing on a phone. Desktop keeps the side-by-side panes. */}
        <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row">
          {/* Receipt image */}
          <aside className="lg:shrink-0 flex flex-col lg:w-[40%] border-b lg:border-b-0 lg:border-r border-border bg-surface-2/30">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60">
              <p className="text-xs font-semibold text-foreground truncate">
                {imageFile?.name ?? (existingImage ? 'Receipt image' : 'No image yet')}
              </p>
              <div className="flex items-center gap-3 shrink-0">
                {imagePreview && <button onClick={() => { setImageFile(null); setImagePreview(null) }} className="text-danger text-xs font-medium">Remove</button>}
                <button onClick={() => setShowPreview(v => !v)} className="lg:hidden text-muted hover:text-foreground">
                  {showPreview ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
            </div>
            <div className={`${showPreview ? 'block' : 'hidden'} lg:block p-3 h-64 lg:h-auto lg:flex-1 lg:min-h-0`}>
              {imagePreview ? (
                previewIsPdf ? (
                  <iframe src={`${imagePreview}#toolbar=0&navpanes=0`} title="Receipt PDF" className="w-full h-full rounded-xl border border-border-strong/50 bg-surface" />
                ) : (
                  <a href={imagePreview} target="_blank" rel="noopener noreferrer" className="block w-full h-full bg-surface-2 rounded-xl overflow-hidden">
                    <img src={imagePreview} alt="Receipt" className="w-full h-full object-contain" />
                  </a>
                )
              ) : existingImage ? (
                <ReceiptViewer path={existingImage} className="w-full h-full" fit />
              ) : (
                <button onClick={() => fileRef.current?.click()}
                  className="w-full h-full rounded-xl border border-dashed border-border-strong flex flex-col items-center justify-center gap-1.5 text-muted hover:text-accent hover:border-accent/50 transition-colors">
                  <ImageIcon size={22} />
                  <span className="text-sm font-medium">Attach receipt</span>
                  <span className="text-[11px] text-faint">Image or PDF</span>
                </button>
              )}
            </div>

            {/* Linked services — shown in every mode, including when empty */}
            <div className="shrink-0 border-t border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wide text-faint mb-2">Linked services</p>
              {linkedLogIds.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-faint text-xs">No services linked yet.</p>
                  {onGoToServices && (
                    <button onClick={onGoToServices} className="w-full flex items-center justify-center gap-1.5 bg-surface border border-border rounded-xl py-2 text-xs font-semibold text-accent hover:border-accent/40 transition-colors">
                      <ExternalLink size={12} /> Go to Services
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {linkedLogIds.map(id => {
                    const l = logById.get(id)
                    if (!l) return null
                    const isOrigin = mode === 'past' && id === past?.logId
                    return (
                      <div key={id} className="bg-surface border border-border rounded-xl px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground text-sm font-medium truncate">{l.service_type}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {/* $0 is a real answer, so test for null rather than truthiness */}
                            {l.cost != null && <span className="text-faint text-xs">${Number(l.cost).toFixed(2)}</span>}
                            <button onClick={() => onOpenService?.(id)} title="Open on the Services page"
                              className="text-faint hover:text-accent"><ExternalLink size={12} /></button>
                          </div>
                        </div>
                        <p className="text-faint text-[11px]">
                          {format(parseISO(l.date), 'MMM d, yyyy')} · {l.performed_by === 'shop' ? 'Shop' : 'DIY'}
                          {isOrigin && ' · this receipt came from here'}
                        </p>
                        <p className="text-faint text-[11px] mt-0.5">Editable below ↓</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>

          <div className="flex-1 lg:min-h-0 lg:overflow-y-auto p-6 space-y-5">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={pickImage} />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Store / shop</label>
                <input type="text" placeholder="e.g. Costco" value={store} onChange={e => setStore(e.target.value)} className={inputCls} />
              </div>
            </div>

            <label className="flex items-start gap-2.5 bg-surface-2/50 border border-border rounded-2xl p-3 cursor-pointer">
              <input type="checkbox" checked={serviceOnly} onChange={e => setServiceOnly(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
              <span>
                <span className="text-foreground text-sm font-medium block">No products on this receipt</span>
                <span className="text-faint text-xs">Services only — hides the products section.</span>
              </span>
            </label>

            {/* ── Products ─────────────────────────────────────────────── */}
            {!serviceOnly && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Package size={13} className="text-muted" />
                  <label className="text-xs font-medium text-muted">Products on this receipt</label>
                </div>
                <div className="space-y-3">
                  {lines.map(l => {
                    const isNew = !l.productId
                    const qtyN = num(l.qty)
                    const locked = Boolean(l.itemId && consumedItemIds.has(l.itemId))
                    const s = stock?.get(l.productId)
                    return (
                      <div key={l.key} className="bg-surface-2/50 border border-border rounded-2xl p-3 space-y-2">
                        <div className="flex gap-2">
                          <select value={l.productId} onChange={e => pickProduct(l.key, e.target.value)} className={`${inputCls} flex-1`}>
                            <option value="">+ New product…</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}
                          </select>
                          {lines.length > 1 && (
                            <button onClick={() => removeLine(l)} disabled={locked}
                              title={locked ? 'Already used in a service — can’t remove' : 'Remove line'}
                              className="w-9 h-9 shrink-0 rounded-xl bg-surface-2 flex items-center justify-center text-muted hover:text-danger disabled:opacity-30 transition-colors"><Trash2 size={14} /></button>
                          )}
                        </div>
                        {isNew && (
                          <div className="grid grid-cols-2 gap-2">
                            <input type="text" placeholder="Product name *" value={l.newName} onChange={e => nameLine(l, e.target.value)} className={inputCls} />
                            <input type="text" placeholder="Brand" value={l.newBrand} onChange={e => patchLine(l.key, { newBrand: e.target.value })} className={inputCls} />
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">Amount</label>
                            <input type="number" inputMode="decimal" placeholder="0" value={l.qty} onChange={e => patchLine(l.key, { qty: e.target.value })} className={inputCls} />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">Unit</label>
                            <select value={l.unit} onChange={e => patchLine(l.key, { unit: e.target.value, unitTouched: true })} className={inputCls}>
                              {UNIT_GROUPS.map(g => (
                                <optgroup key={g.label} label={g.label}>
                                  {g.units.map(u => <option key={u} value={u}>{u}</option>)}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">$ / unit</label>
                            <input type="number" inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={e => patchLine(l.key, { unitPrice: e.target.value })} className={inputCls} />
                          </div>
                        </div>
                        {mode === 'past' && qtyN != null && (
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">How much is left now? (optional)</label>
                            <input type="number" inputMode="decimal" placeholder={`${qtyN} = none used yet`} value={l.leftNow} onChange={e => patchLine(l.key, { leftNow: e.target.value })} className={inputCls} />
                            {num(l.leftNow) != null && num(l.leftNow)! < qtyN && (
                              <p className="text-faint text-[10px] mt-1">Records {fmtQty(qtyN - num(l.leftNow)!, l.unit)} as used before tracking started.</p>
                            )}
                          </div>
                        )}
                        {s && <p className="text-faint text-[11px]">Currently {fmtQty(s.onHand, s.unit)} on hand.</p>}
                      </div>
                    )
                  })}
                </div>
                <button onClick={() => setLines(prev => [...prev, emptyLine()])} className="mt-2 flex items-center gap-1.5 text-muted hover:text-accent text-sm transition-colors">
                  <Plus size={13} /> Add another product
                </button>
              </div>
            )}

            {/* ── Services ─────────────────────────────────────────────── */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Wrench size={13} className="text-muted" />
                <label className="text-xs font-medium text-muted">Services on this receipt</label>
              </div>
              {linkedLogIds.length > 0 && services.length === 0 && (
                <p className="text-faint text-xs mb-2">
                  Already linked to {linkedLogIds.length} service{linkedLogIds.length === 1 ? '' : 's'}
                  {linkedShop ? ', including shop work — nothing more needed.' : '. Add one only if this receipt also paid for work done.'}
                </p>
              )}
              <div className="space-y-3">
                {services.map(s => (
                  <div key={s.key} className="bg-surface-2/50 border border-border rounded-2xl p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-1.5">
                        {(['shop', 'owner'] as const).map(p => (
                          <button key={p} onClick={() => patchService(s.key, { performedBy: p })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                              s.performedBy === p ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong'
                            }`}>{p === 'shop' ? 'Shop' : 'DIY'}</button>
                        ))}
                      </div>
                      <button onClick={() => setServices(prev => prev.filter(x => x.key !== s.key))}
                        className="w-8 h-8 rounded-xl bg-surface-2 flex items-center justify-center text-muted hover:text-danger transition-colors"><Trash2 size={13} /></button>
                    </div>

                    {/* Linked records stay fully editable here — same fields either
                        way, so there's no second UI just to change a service. */}
                    {s.linkedLogId && (
                      <div className="flex items-center justify-between gap-2 bg-accent/5 border border-accent/20 rounded-xl px-3 py-1.5">
                        <span className="text-accent text-[11px] font-medium">Editing an existing record</span>
                        <button onClick={() => patchService(s.key, { linkedLogId: null })} className="text-muted hover:text-foreground text-xs shrink-0">Unlink</button>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <select value={s.categoryId} onChange={e => patchService(s.key, { categoryId: e.target.value })} className={inputCls}>
                        <option value="">Pick a category…</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <input type="text" placeholder="or type a name" value={s.serviceType} onChange={e => patchService(s.key, { serviceType: e.target.value })} className={inputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">Odometer</label>
                        <input type="number" inputMode="numeric" placeholder="miles" value={s.odometer} onChange={e => patchService(s.key, { odometer: e.target.value })} className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">Cost</label>
                        <input type="number" inputMode="decimal" placeholder="0.00" value={s.cost} onChange={e => patchService(s.key, { cost: e.target.value })} className={inputCls} />
                      </div>
                    </div>
                    {/* Date and shop come from the receipt above — not asked twice. */}
                    <p className="text-faint text-[11px]">
                      Dated {date || '—'}{store.trim() ? ` · ${store.trim()}` : ''}, from this receipt.
                    </p>
                    {!s.linkedLogId && (
                      <button onClick={() => { setPicking(s.key); setFilter(EMPTY_FILTER) }}
                        className="flex items-center gap-1.5 text-muted hover:text-accent text-xs transition-colors">
                        <Link2 size={12} /> Link to a service I already logged
                      </button>
                    )}

                    {/* DIY savings — only meaningful when you did it yourself */}
                    {s.performedBy === 'owner' && (
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">What a shop would have charged (optional)</label>
                        <input type="number" inputMode="decimal" placeholder="0.00" value={s.shopEquivalent} onChange={e => patchService(s.key, { shopEquivalent: e.target.value })} className={inputCls} />
                        {num(s.shopEquivalent) != null && (
                          <p className="text-success text-[11px] mt-1">
                            Saved ${Math.max(0, num(s.shopEquivalent)! - (num(s.cost) ?? 0)).toFixed(2)} doing it yourself.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={() => setServices(prev => [...prev, emptyService(date)])} className="mt-2 flex items-center gap-1.5 text-muted hover:text-accent text-sm transition-colors">
                <Plus size={13} /> Add a service
              </button>
              {services.length > 0 && (
                <p className="text-faint text-[11px] mt-2">
                  {carriesShopService
                    ? 'This receipt will be flagged as containing a shop service.'
                    : 'DIY only — this receipt stays a products receipt, just linked to the service.'}
                </p>
              )}
            </div>

            {grandTotal > 0 && (
              <p className="text-muted text-sm">
                Receipt total: <span className="text-foreground font-semibold">${grandTotal.toFixed(2)}</span>
                {!serviceOnly && partsTotal > 0 && servicesTotal > 0 && (
                  <span className="text-faint"> · ${partsTotal.toFixed(2)} parts + ${servicesTotal.toFixed(2)} services</span>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 space-y-3">
          {error && <p className="text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!canSave || saving} className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors">
              {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Save receipt'}
            </button>
          </div>
        </div>
      </div>

      {/* Existing-service picker — same filter component as the history page */}
      {picking && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) setPicking(null) }}>
          <div className="bg-surface border border-border rounded-3xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
              <h4 className="font-bold text-foreground">Link an existing service</h4>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowFilters(v => !v)} className={`${isFilterActive(filter) ? 'text-accent' : 'text-muted'} hover:text-foreground`}><SlidersHorizontal size={16} /></button>
                <button onClick={() => setPicking(null)} className="text-muted hover:text-foreground"><X size={18} /></button>
              </div>
            </div>
            {showFilters && (
              <div className="shrink-0 border-b border-border p-4">
                <ServiceFilterPanel value={filter} onChange={setFilter} types={allTypes} showSearch compact />
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
              {filteredLogs.length === 0 && <p className="text-faint text-sm text-center py-8">No services match.</p>}
              {filteredLogs.map(l => (
                <button key={l.id} onClick={() => linkExisting(picking, l)}
                  className="w-full text-left bg-surface-2/50 border border-border rounded-xl px-3 py-2.5 hover:border-accent/40 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground text-sm font-medium truncate">{l.service_type}</span>
                    {l.cost != null && <span className="text-faint text-xs shrink-0">${Number(l.cost).toFixed(2)}</span>}
                  </div>
                  <p className="text-faint text-[11px]">
                    {format(parseISO(l.date), 'MMM d, yyyy')} · {l.odometer.toLocaleString()} mi · {l.performed_by === 'shop' ? 'Shop' : 'DIY'}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
