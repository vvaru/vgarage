'use client'

import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { X, Plus, Receipt as ReceiptIcon, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { withRetry, withTimeout } from '@/lib/recover'
import ReceiptStep from './wizard/ReceiptStep'
import ServiceStep from './wizard/ServiceStep'
import {
  availableProducts, emptyLine, emptyReceipt, groupServiceTags, mergeGroupEdits, isPending,
  type ReceiptDraft, type ServiceGroup,
} from '@/lib/recordDraft'
import { planDraw, type Lot, type LotBalance, type ProductStock } from '@/lib/inventory'
import type { Product, Receipt, ReceiptItem, ServiceCategory, ServiceLog, ServiceProductUsage } from '@/lib/types'

type ProductU = Product & { unit?: string }
type Phase = 'receipts' | 'services'

const num = (s: string): number | null => {
  const n = parseFloat(s)
  return s.trim() !== '' && !isNaN(n) ? n : null
}

export interface WizardSeed {
  receipt?: Receipt
  items?: ReceiptItem[]
  logIds?: string[]
  past?: { logId: string; imagePath: string; date: string | null }
}

interface Props {
  seed?: WizardSeed
  products: ProductU[]
  categories: ServiceCategory[]
  logs: ServiceLog[]
  usage?: ServiceProductUsage[]
  stock: Map<string, ProductStock>
  onClose: () => void
  onSaved: () => void
}

export default function RecordWizard({
  seed, products, categories, logs, usage = [], stock, onClose, onSaved,
}: Props) {
  const { user } = useAuth()
  const { vehicle } = useVehicle()

  const today = format(new Date(), 'yyyy-MM-dd')
  const [phase, setPhase] = useState<Phase>('receipts')
  const [current, setCurrent] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [receipts, setReceipts] = useState<ReceiptDraft[]>(() => {
    const base = emptyReceipt(today)
    if (seed?.past) {
      return [{ ...base, originLogId: seed.past.logId, existingImage: seed.past.imagePath, date: seed.past.date ?? today }]
    }
    if (seed?.receipt) {
      const r = seed.receipt
      return [{
        ...base,
        receiptId: r.id,
        existingImage: r.image_path,
        date: r.date ?? today,
        store: r.store ?? '',
        noProducts: Boolean(r.no_products),
        lines: (seed.items ?? []).length > 0
          ? (seed.items ?? []).map(it => ({
              ...emptyLine(),
              key: it.id, itemId: it.id, productId: it.product_id,
              unit: products.find(p => p.id === it.product_id)?.unit ?? 'each',
              unitTouched: true,
              qty: String(it.qty),
              unitPrice: it.unit_cost == null ? '' : String(it.unit_cost),
            }))
          : [emptyLine()],
      }]
    }
    return [base]
  })
  const [groups, setGroups] = useState<ServiceGroup[]>([])

  const saveIds = useRef<{ receipts: Record<string, string>; lines: Record<string, string>; logs: Record<string, string> } | null>(null)

  // Existing lines already drawn from can't be removed without breaking a service.
  const lockedItemIds = useMemo(() => {
    const mine = new Set((seed?.items ?? []).map(i => i.id))
    const out = new Set<string>()
    for (const u of usage) if (u.receipt_item_id && mine.has(u.receipt_item_id)) out.add(u.receipt_item_id)
    return out
  }, [usage, seed?.items])

  const productName = (id: string) => products.find(p => p.id === id)?.name ?? 'Product'
  const productUnit = (id: string) => products.find(p => p.id === id)?.unit ?? 'each'
  const available = useMemo(
    () => availableProducts(receipts, stock, productName, productUnit),
    [receipts, stock, products],
  )

  const patchReceipt = (key: string, patch: Partial<ReceiptDraft>) =>
    setReceipts(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r))

  function goToServices() {
    setGroups(prev => mergeGroupEdits(groupServiceTags(receipts, categories), prev))
    setPhase('services')
  }

  const pendingCount = receipts.filter(isPending).length

  async function handleSave() {
    if (!user || !vehicle) return
    setSaving(true)
    setError(null)
    if (!saveIds.current) {
      saveIds.current = {
        receipts: Object.fromEntries(receipts.map(r => [r.key, r.receiptId ?? crypto.randomUUID()])),
        lines: Object.fromEntries(receipts.flatMap(r => r.lines.map(l => [`${r.key}:${l.key}`, l.itemId ?? crypto.randomUUID()]))),
        logs: Object.fromEntries(groups.map(g => [g.key, g.linkedLogId ?? crypto.randomUUID()])),
      }
    }
    const ids = saveIds.current

    try {
      // Lots created in this save, so product draws can be allocated against them.
      const freshLots = new Map<string, Lot[]>()
      const draftLineToProduct = new Map<string, string>()   // `draft:<lineKey>` → real product id

      // ── 1. Receipts, their products and their lots ───────────────────────
      for (const r of receipts) {
        const receiptId = ids.receipts[r.key]

        let imagePath = r.existingImage
        if (r.file) {
          const ext = r.file.name.split('.').pop() ?? 'jpg'
          const path = `${user.id}/${crypto.randomUUID()}.${ext}`
          const { error: upErr } = await withTimeout(supabase.storage.from('receipts').upload(path, r.file, { upsert: true }), 20000)
          if (!upErr) imagePath = path
        }

        const parts = r.noProducts ? 0 : r.lines.reduce((s, l) => s + (num(l.qty) ?? 0) * (num(l.unitPrice) ?? 0), 0)
        const svc = r.tags.reduce((s, t) => s + (num(t.amount) ?? 0), 0)
        const total = parts + svc

        const { error: rErr } = await withRetry(() => withTimeout(supabase.from('receipts').upsert({
          id: receiptId, user_id: user.id, date: r.date || null, store: r.store.trim() || null,
          image_path: imagePath, no_products: r.noProducts,
          total_cost: total > 0 ? Math.round(total * 100) / 100 : null,
        }), 9000), 2, 800)
        if (rErr) throw new Error(rErr.message)

        if (r.noProducts) continue
        for (const l of r.lines) {
          const qty = num(l.qty)
          if (!(l.productId || l.newName.trim()) || qty == null) continue
          const itemId = ids.lines[`${r.key}:${l.key}`]
          let pid = l.productId

          if (!pid) {
            pid = itemId   // reuse the stable id so a retry doesn't duplicate the product
            const { error: pErr } = await withRetry(() => withTimeout(supabase.from('products').upsert({
              id: pid, user_id: user.id, vehicle_id: null,
              name: l.newName.trim(), brand: l.newBrand.trim() || null, unit: l.unit || 'each',
            }), 9000), 2, 800)
            if (pErr) throw new Error(pErr.message)
            draftLineToProduct.set(`draft:${l.key}`, pid)
          } else {
            const currentUnit = products.find(p => p.id === pid)?.unit ?? 'each'
            if (currentUnit !== l.unit) {
              await withTimeout(supabase.from('products').update({ unit: l.unit }).eq('id', pid), 9000)
            }
          }

          const { error: iErr } = await withRetry(() => withTimeout(supabase.from('receipt_items').upsert({
            id: itemId, receipt_id: receiptId, product_id: pid, qty, unit_cost: num(l.unitPrice),
          }), 9000), 2, 800)
          if (iErr) throw new Error(iErr.message)

          const lot: Lot = {
            id: itemId, kind: 'receipt', sourceId: receiptId, productId: pid,
            date: r.date || null, qty, unitCost: num(l.unitPrice),
          }
          freshLots.set(pid, [...(freshLots.get(pid) ?? []), lot])
        }
      }

      // ── 2. Services, then their receipts, then their stock draws ─────────
      for (const g of groups) {
        const logId = ids.logs[g.key]
        const cat = categories.find(c => c.id === g.categoryId)
        const fields = {
          service_type: (cat?.name ?? g.customName ?? g.label).trim() || 'Service',
          category_id: g.categoryId || null,
          record_type: cat?.category_type ?? 'maintenance',
          performed_by: g.performedBy === 'shop' ? 'shop' : 'owner',
          shop_name: g.performedBy === 'shop'
            ? (receipts.find(r => r.key === g.members[0]?.receiptKey)?.store.trim() || null)
            : null,
          date: g.date,
          odometer: num(g.odometer) ?? vehicle.odometer,
          cost: num(g.cost),
          shop_equivalent_cost: g.performedBy === 'owner' ? num(g.shopEquivalent) : null,
          notes: g.notes.trim() || null,
        }

        if (g.linkedLogId) {
          const { error: uErr } = await withRetry(() => withTimeout(
            supabase.from('service_logs').update(fields).eq('id', logId), 9000), 2, 800)
          if (uErr) throw new Error(uErr.message)
        } else {
          const { error: lErr } = await withRetry(() => withTimeout(supabase.from('service_logs').upsert({
            id: logId, user_id: user.id, vehicle_id: vehicle.id, ...fields,
          }), 9000), 2, 800)
          if (lErr) throw new Error(lErr.message)
        }

        // Attach every receipt that fed this service.
        for (const receiptKey of new Set(g.members.map(m => m.receiptKey))) {
          await withTimeout(supabase.from('service_log_receipts')
            .upsert({ log_id: logId, receipt_id: ids.receipts[receiptKey] }), 9000)
        }

        // Draw stock FIFO across committed lots plus the ones just written.
        for (const d of g.draws) {
          const want = num(d.qty)
          if (want == null || want <= 0) continue
          const pid = d.productKey.startsWith('draft:')
            ? draftLineToProduct.get(d.productKey)
            : d.productKey
          if (!pid) continue

          const committed: LotBalance[] = (stock.get(pid)?.lots ?? []).filter(b => b.remaining > 0)
          const incoming: LotBalance[] = (freshLots.get(pid) ?? []).map(lot => ({ lot, used: 0, remaining: lot.qty }))
          const all = [...committed, ...incoming].sort((a, b) => {
            const x = a.lot.date, y = b.lot.date
            if (x === y) return 0
            if (!x) return 1
            if (!y) return -1
            return x < y ? -1 : 1
          })

          const { plan, short } = planDraw(all, want)
          for (const p of plan) {
            const { error: uErr } = await withRetry(() => withTimeout(supabase.from('service_product_usage').upsert({
              id: crypto.randomUUID(), log_id: logId, product_id: pid,
              receipt_item_id: p.lot.lot.kind === 'receipt' ? p.lot.lot.id : null,
              qty: p.qty, unit_cost: p.lot.lot.unitCost,
            }), 9000), 2, 800)
            if (uErr) throw new Error(uErr.message)
          }
          // Used more than we can account for — still record it, unallocated.
          if (short > 0) {
            await withTimeout(supabase.from('service_product_usage').insert({
              log_id: logId, product_id: pid, receipt_item_id: null, qty: short, unit_cost: null,
            }), 9000)
          }
        }
      }

      // ── 3. A past receipt stays attached to the record it came from ──────
      for (const r of receipts) {
        if (!r.originLogId) continue
        await withTimeout(supabase.from('service_log_receipts')
          .upsert({ log_id: r.originLogId, receipt_id: ids.receipts[r.key] }), 9000)
      }

      saveIds.current = null
      onSaved()
    } catch (e) {
      setError(`Couldn’t save (${e instanceof Error ? e.message : String(e)}). Nothing was lost — tap Save to try again.`)
    } finally {
      setSaving(false)
    }
  }

  const draft = receipts[current]

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-border rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"><ReceiptIcon size={17} className="text-accent" /></div>
              <div className="min-w-0">
                <h3 className="font-bold text-foreground text-lg truncate">
                  {phase === 'receipts' ? (seed ? 'Edit receipt' : 'Add records') : 'Service details'}
                </h3>
                <p className="text-faint text-xs">
                  {phase === 'receipts'
                    ? `Step 1 of 2 · what's on the receipt${receipts.length > 1 ? ` · ${current + 1} of ${receipts.length}` : ''}`
                    : 'Step 2 of 2 · the rest of the story'}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-muted hover:text-foreground shrink-0"><X size={20} /></button>
          </div>

          {/* Receipt switcher — only earns its space with more than one */}
          {phase === 'receipts' && receipts.length > 1 && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              {receipts.map((r, i) => (
                <button key={r.key} onClick={() => setCurrent(i)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    i === current ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong'
                  }`}>
                  {r.store.trim() || `Receipt ${i + 1}`}
                </button>
              ))}
              <button onClick={() => { setReceipts(prev => prev.filter((_, i) => i !== current)); setCurrent(0) }}
                title="Remove this receipt"
                className="w-7 h-7 rounded-lg bg-surface-2 border border-border-strong flex items-center justify-center text-muted hover:text-danger transition-colors"><Trash2 size={12} /></button>
            </div>
          )}
        </div>

        {phase === 'receipts' ? (
          <ReceiptStep
            draft={draft}
            products={products}
            categories={categories}
            stock={stock}
            lockedItemIds={lockedItemIds}
            onPatch={p => patchReceipt(draft.key, p)}
          />
        ) : (
          <ServiceStep groups={groups} setGroups={setGroups} receipts={receipts} available={available} logs={logs} />
        )}

        <div className="shrink-0 border-t border-border px-6 py-4 space-y-3">
          {error && <p className="text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">{error}</p>}
          {phase === 'services' && pendingCount > 0 && (
            <p className="text-faint text-xs">
              {pendingCount} receipt{pendingCount === 1 ? '' : 's'} with nothing on {pendingCount === 1 ? 'it' : 'them'} will be saved under “to import”.
            </p>
          )}
          <div className="flex gap-3">
            {phase === 'receipts' ? (
              <>
                <button onClick={() => { setReceipts(prev => [...prev, emptyReceipt(today)]); setCurrent(receipts.length) }}
                  className="flex items-center justify-center gap-1.5 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl px-4 py-3 transition-colors">
                  <Plus size={15} /> <span className="hidden sm:inline">Another receipt</span>
                </button>
                <button onClick={goToServices}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl py-3 transition-colors">
                  Next <ChevronRight size={16} />
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setPhase('receipts')}
                  className="flex items-center justify-center gap-1.5 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl px-4 py-3 transition-colors">
                  <ChevronLeft size={16} /> Back
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors">
                  {saving ? 'Saving…' : 'Save everything'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
