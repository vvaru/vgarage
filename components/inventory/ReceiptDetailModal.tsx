'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { X, Plus, Trash2, Receipt as ReceiptIcon, Wrench, Package, ExternalLink, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { withRetry, withTimeout } from '@/lib/recover'
import ReceiptViewer from '@/components/ui/ReceiptViewer'
import { UNIT_GROUPS, fmtQty, fmtNum } from '@/lib/units'
import type { Product, Receipt, ReceiptItem, ServiceProductUsage } from '@/lib/types'
import type { ProductStock } from '@/lib/inventory'

const num = (s: string): number | null => {
  const n = parseFloat(s)
  return s.trim() !== '' && !isNaN(n) ? n : null
}

type ProductU = Product & { unit?: string }

export interface LogInfo { id: string; date: string; service_type: string }

interface LineDraft {
  key: string
  itemId: string | null    // null = a line added in this session
  productId: string
  unit: string
  qty: string
  unitPrice: string
}

interface Props {
  receipt: Receipt
  items: ReceiptItem[]              // this receipt's lines
  products: ProductU[]
  usage: ServiceProductUsage[]      // all usage rows; filtered to this receipt here
  stock: Map<string, ProductStock>
  logs: LogInfo[]
  directLogIds: string[]            // from service_log_receipts
  onClose: () => void
  onSaved: () => void
  onOpenService?: (logId: string) => void
}

export default function ReceiptDetailModal({
  receipt, items, products, usage, stock, logs, directLogIds, onClose, onSaved, onOpenService,
}: Props) {
  const [date, setDate] = useState(receipt.date ?? '')
  const [store, setStore] = useState(receipt.store ?? '')
  const [noProducts, setNoProducts] = useState(Boolean(receipt.no_products))
  const [lines, setLines] = useState<LineDraft[]>(() =>
    items.map(it => ({
      key: it.id,
      itemId: it.id,
      productId: it.product_id,
      unit: products.find(p => p.id === it.product_id)?.unit ?? 'each',
      qty: String(it.qty),
      unitPrice: it.unit_cost == null ? '' : String(it.unit_cost),
    })),
  )
  const [removed, setRemoved] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const itemIds = useMemo(() => new Set(items.map(i => i.id)), [items])
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const logById = useMemo(() => new Map(logs.map(l => [l.id, l])), [logs])

  // Every service that drew from this receipt's lots, collapsed to one entry per
  // service even when several lines (or several lots) went into the same job.
  const linkedServices = useMemo(() => {
    const byLog = new Map<string, { log: LogInfo; parts: { name: string; qty: number; unit: string }[]; direct: boolean }>()
    for (const u of usage) {
      if (!u.receipt_item_id || !itemIds.has(u.receipt_item_id)) continue
      const log = logById.get(u.log_id)
      if (!log) continue
      const p = productById.get(u.product_id)
      const entry = byLog.get(u.log_id) ?? { log, parts: [], direct: false }
      const existing = entry.parts.find(x => x.name === (p?.name ?? 'Unknown'))
      if (existing) existing.qty += Number(u.qty)
      else entry.parts.push({ name: p?.name ?? 'Unknown', qty: Number(u.qty), unit: p?.unit ?? 'each' })
      byLog.set(u.log_id, entry)
    }
    // Receipts attached straight to a service (labour bills) with no stock movement.
    for (const id of directLogIds) {
      const log = logById.get(id)
      if (!log) continue
      if (!byLog.has(id)) byLog.set(id, { log, parts: [], direct: true })
    }
    return [...byLog.values()].sort((a, b) => b.log.date.localeCompare(a.log.date))
  }, [usage, itemIds, logById, productById, directLogIds])

  // A line whose lot has already been drawn from can't be safely deleted.
  const consumedItemIds = useMemo(() => {
    const s = new Set<string>()
    for (const u of usage) if (u.receipt_item_id && itemIds.has(u.receipt_item_id)) s.add(u.receipt_item_id)
    return s
  }, [usage, itemIds])
  const anyConsumed = consumedItemIds.size > 0

  const total = lines.reduce((s, l) => s + (num(l.qty) ?? 0) * (num(l.unitPrice) ?? 0), 0)

  function patch(key: string, p: Partial<LineDraft>) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...p } : l))
  }
  function pickProduct(key: string, productId: string) {
    patch(key, { productId, unit: productById.get(productId)?.unit ?? 'each' })
  }
  function removeLine(l: LineDraft) {
    if (l.itemId && consumedItemIds.has(l.itemId)) return
    if (l.itemId) setRemoved(prev => [...prev, l.itemId!])
    setLines(prev => prev.filter(x => x.key !== l.key))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const { error: rErr } = await withRetry(() => withTimeout(supabase.from('receipts').update({
        date: date || null,
        store: store.trim() || null,
        no_products: noProducts,
        total_cost: total > 0 ? Math.round(total * 100) / 100 : null,
      }).eq('id', receipt.id), 9000), 2, 800)
      if (rErr) throw new Error(rErr.message)

      // Units live on the product, so editing one here updates the product itself.
      for (const l of lines) {
        if (!l.productId) continue
        const current = productById.get(l.productId)
        if (current && (current.unit ?? 'each') !== l.unit) {
          const { error: uErr } = await withTimeout(supabase.from('products').update({ unit: l.unit }).eq('id', l.productId), 9000)
          if (uErr) throw new Error(uErr.message)
        }
      }

      for (const id of removed) {
        const { error: dErr } = await withTimeout(supabase.from('receipt_items').delete().eq('id', id), 9000)
        if (dErr) throw new Error(dErr.message)
      }

      for (const l of lines) {
        const qty = num(l.qty)
        if (!l.productId || qty == null) continue
        const { error: iErr } = await withRetry(() => withTimeout(supabase.from('receipt_items').upsert({
          id: l.itemId ?? l.key,
          receipt_id: receipt.id,
          product_id: l.productId,
          qty,
          unit_cost: num(l.unitPrice),
        }), 9000), 2, 800)
        if (iErr) throw new Error(iErr.message)
      }

      onSaved()
    } catch (e) {
      setError(`Couldn’t save (${e instanceof Error ? e.message : String(e)}). Nothing was lost — tap Save to try again.`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setSaving(true)
    setError(null)
    try {
      // receipt_items cascade; usage rows keep their history via ON DELETE SET NULL.
      const { error: dErr } = await withTimeout(supabase.from('receipts').delete().eq('id', receipt.id), 9000)
      if (dErr) throw new Error(dErr.message)
      onSaved()
    } catch (e) {
      setError(`Couldn’t delete (${e instanceof Error ? e.message : String(e)}).`)
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all'

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-border rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"><ReceiptIcon size={17} className="text-accent" /></div>
            <div className="min-w-0">
              <h3 className="font-bold text-foreground text-lg truncate">{store.trim() || 'Receipt'}</h3>
              <p className="text-faint text-xs">{date ? format(parseISO(date), 'MMM d, yyyy') : 'No date'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground shrink-0"><X size={20} /></button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* Image + where it all went */}
          <aside className="shrink-0 flex flex-col lg:w-[42%] border-b lg:border-b-0 lg:border-r border-border bg-surface-2/30">
            <div className="p-3 h-64 lg:h-auto lg:flex-1 lg:min-h-0">
              {receipt.image_path ? (
                <ReceiptViewer path={receipt.image_path} className="w-full h-full" fit />
              ) : (
                <div className="w-full h-full rounded-xl border border-dashed border-border-strong flex flex-col items-center justify-center gap-2 text-faint">
                  <ReceiptIcon size={22} />
                  <span className="text-xs">No image on this receipt</span>
                </div>
              )}
            </div>

            {/* One row per service, however many lines fed into it */}
            <div className="shrink-0 border-t border-border/60 p-3 max-h-56 overflow-y-auto">
              <p className="text-[10px] uppercase tracking-wide text-faint mb-2">
                Used in {linkedServices.length} service{linkedServices.length === 1 ? '' : 's'}
              </p>
              {linkedServices.length === 0 ? (
                <p className="text-faint text-xs">Nothing from this receipt has been used yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {linkedServices.map(s => (
                    <button
                      key={s.log.id}
                      onClick={() => onOpenService?.(s.log.id)}
                      className="w-full text-left bg-surface border border-border rounded-xl px-3 py-2 hover:border-accent/40 transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-foreground text-sm font-medium truncate">{s.log.service_type}</span>
                        <ExternalLink size={12} className="text-faint group-hover:text-accent shrink-0" />
                      </div>
                      <p className="text-faint text-[11px]">
                        {format(parseISO(s.log.date), 'MMM d, yyyy')}
                        {s.direct
                          ? ' · attached to this service'
                          : ` · ${s.parts.map(p => fmtQty(p.qty, p.unit)).join(', ')}`}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Store</label>
                <input type="text" placeholder="e.g. Costco" value={store} onChange={e => setStore(e.target.value)} className={inputCls} />
              </div>
            </div>

            <label className="flex items-start gap-2.5 bg-surface-2/50 border border-border rounded-2xl p-3 cursor-pointer">
              <input type="checkbox" checked={noProducts} onChange={e => setNoProducts(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
              <span>
                <span className="text-foreground text-sm font-medium block">No products on this receipt</span>
                <span className="text-faint text-xs">Labour or shop services only — stop asking me to fill it in.</span>
              </span>
            </label>

            {!noProducts && (
              <div>
                <label className="block text-xs font-medium text-muted mb-2">What was on this receipt</label>
                <div className="space-y-3">
                  {lines.map(l => {
                    const locked = Boolean(l.itemId && consumedItemIds.has(l.itemId))
                    const s = stock.get(l.productId)
                    return (
                      <div key={l.key} className="bg-surface-2/50 border border-border rounded-2xl p-3 space-y-2">
                        <div className="flex gap-2">
                          <select value={l.productId} onChange={e => pickProduct(l.key, e.target.value)} className={`${inputCls} flex-1`}>
                            <option value="">Pick a product…</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}
                          </select>
                          <button
                            onClick={() => removeLine(l)}
                            disabled={locked}
                            title={locked ? 'Already used in a service — can’t remove' : 'Remove line'}
                            className="w-9 h-9 shrink-0 rounded-xl bg-surface-2 flex items-center justify-center text-muted hover:text-danger disabled:opacity-30 disabled:hover:text-muted transition-colors"
                          ><Trash2 size={14} /></button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">Amount</label>
                            <input type="number" inputMode="decimal" value={l.qty} onChange={e => patch(l.key, { qty: e.target.value })} className={inputCls} />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">Unit</label>
                            <select value={l.unit} onChange={e => patch(l.key, { unit: e.target.value })} className={inputCls}>
                              {UNIT_GROUPS.map(g => (
                                <optgroup key={g.label} label={g.label}>
                                  {g.units.map(u => <option key={u} value={u}>{u}</option>)}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">$ / unit</label>
                            <input type="number" inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={e => patch(l.key, { unitPrice: e.target.value })} className={inputCls} />
                          </div>
                        </div>
                        <p className="text-faint text-[11px]">
                          Unit changes apply to the product everywhere.
                          {s && ` Currently ${fmtQty(s.onHand, s.unit)} on hand.`}
                        </p>
                      </div>
                    )
                  })}
                </div>
                <button
                  onClick={() => setLines(prev => [...prev, { key: crypto.randomUUID(), itemId: null, productId: '', unit: 'each', qty: '', unitPrice: '' }])}
                  className="mt-2 flex items-center gap-1.5 text-muted hover:text-accent text-sm transition-colors"
                ><Plus size={13} /> Add another product</button>
              </div>
            )}

            {total > 0 && <p className="text-muted text-sm">Receipt total: <span className="text-foreground font-semibold">${total.toFixed(2)}</span></p>}

            <div className="pt-2 border-t border-border">
              {confirmDelete ? (
                <div className="bg-danger/10 border border-danger/20 rounded-2xl p-3">
                  {anyConsumed ? (
                    <p className="text-foreground text-sm flex items-start gap-2">
                      <AlertTriangle size={15} className="text-danger shrink-0 mt-0.5" />
                      Some of this receipt is already used in a service. Delete it and those services lose their cost and paperwork.
                    </p>
                  ) : (
                    <p className="text-foreground text-sm">Delete this receipt and its {lines.length} line{lines.length === 1 ? '' : 's'}?</p>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setConfirmDelete(false)} className="flex-1 bg-surface-2 text-foreground text-sm font-medium rounded-xl py-2">Keep it</button>
                    <button onClick={handleDelete} disabled={saving} className="flex-1 bg-danger text-white text-sm font-bold rounded-xl py-2 disabled:opacity-50">Delete</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="text-danger text-sm font-medium hover:opacity-80">Delete this receipt</button>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 space-y-3">
          {error && <p className="text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
