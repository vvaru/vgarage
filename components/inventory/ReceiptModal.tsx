'use client'

import { useState, useRef } from 'react'
import { format } from 'date-fns'
import { X, Plus, Trash2, Receipt as ReceiptIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { withRetry, withTimeout } from '@/lib/recover'
import type { Product } from '@/lib/types'

const num = (s: string): number | null => {
  const n = parseFloat(s)
  return s.trim() !== '' && !isNaN(n) ? n : null
}

const UNITS = ['gal', 'qt', 'L', 'oz', 'each', 'pair', 'set', 'bottle', 'box']

// A past service receipt being pulled into inventory (image already in storage).
export interface PastReceipt {
  logId: string
  imagePath: string
  date: string | null
  label: string
}

interface LineDraft {
  key: string
  productId: string   // '' = create a new product
  newName: string
  newBrand: string
  unit: string
  qty: string
  unitPrice: string
  leftNow: string     // how much is still on hand now (for backfilling past usage)
}

const emptyLine = (): LineDraft => ({
  key: crypto.randomUUID(), productId: '', newName: '', newBrand: '', unit: 'each', qty: '', unitPrice: '', leftNow: '',
})

interface Props {
  products: Product[]
  past?: PastReceipt | null   // present = completing a past receipt
  onClose: () => void
  onSaved: () => void
}

export default function ReceiptModal({ products, past, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [date, setDate] = useState(past?.date ?? format(new Date(), 'yyyy-MM-dd'))
  const [store, setStore] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveIds = useRef<{ receiptId: string; lines: { itemId: string; productId: string }[] } | null>(null)

  function patchLine(key: string, patch: Partial<LineDraft>) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l))
  }
  function onPickProduct(key: string, productId: string) {
    const p = products.find(x => x.id === productId)
    patchLine(key, { productId, unit: p ? (p as Product & { unit?: string }).unit ?? 'each' : 'each' })
  }
  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setImageFile(f)
    setImagePreview(URL.createObjectURL(f))
    e.target.value = ''
  }

  const total = lines.reduce((s, l) => s + (num(l.qty) ?? 0) * (num(l.unitPrice) ?? 0), 0)
  const canSave = lines.some(l => (l.productId || l.newName.trim()) && num(l.qty) != null)

  async function handleSave() {
    if (!user || !canSave) return
    setSaving(true)
    setError(null)
    if (!saveIds.current) {
      saveIds.current = {
        receiptId: crypto.randomUUID(),
        lines: lines.map(l => ({ itemId: crypto.randomUUID(), productId: l.productId || crypto.randomUUID() })),
      }
    }
    const ids = saveIds.current

    try {
      // 1) Image — reuse the past receipt's image, or upload a new one.
      let imagePath: string | null = past?.imagePath ?? null
      if (!past && imageFile) {
        const ext = imageFile.name.split('.').pop() ?? 'jpg'
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`
        const { error: upErr } = await withTimeout(supabase.storage.from('receipts').upload(path, imageFile, { upsert: true }), 20000)
        if (!upErr) imagePath = path
      }

      // 2) Receipt (idempotent on its id)
      const { error: rErr } = await withRetry(() => withTimeout(supabase.from('receipts').upsert({
        id: ids.receiptId, user_id: user.id, date: date || null, store: store.trim() || null,
        image_path: imagePath, total_cost: total > 0 ? Math.round(total * 100) / 100 : null,
      }), 9000), 2, 800)
      if (rErr) throw new Error(rErr.message)

      // 3) Each line → (new product if needed) + receipt_item lot + optional pre-tracking usage
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        if (!(l.productId || l.newName.trim()) || num(l.qty) == null) continue
        const pid = ids.lines[i].productId

        if (!l.productId) {
          const { error: pErr } = await withRetry(() => withTimeout(supabase.from('products').upsert({
            id: pid, user_id: user.id, vehicle_id: null, name: l.newName.trim(), brand: l.newBrand.trim() || null, unit: l.unit || 'each',
          }), 9000), 2, 800)
          if (pErr) throw new Error(pErr.message)
        }

        const qty = num(l.qty)!
        const { error: iErr } = await withRetry(() => withTimeout(supabase.from('receipt_items').upsert({
          id: ids.lines[i].itemId, receipt_id: ids.receiptId, product_id: pid, qty, unit_cost: num(l.unitPrice),
        }), 9000), 2, 800)
        if (iErr) throw new Error(iErr.message)

        const left = num(l.leftNow)
        if (left != null && left < qty) {
          await withTimeout(supabase.from('inventory_adjustments').insert({
            user_id: user.id, product_id: pid, qty_delta: -(qty - left),
            unit_cost: num(l.unitPrice), note: 'Used before inventory tracking', date: date || null,
          }), 9000)
        }
      }

      // 4) If completing a past receipt, keep it attached to its service record.
      if (past?.logId) {
        await withTimeout(supabase.from('service_log_receipts').upsert({ log_id: past.logId, receipt_id: ids.receiptId }), 9000)
      }

      onSaved()
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      setError(`Couldn’t save (${reason}). Nothing was lost — tap Save to try again.`)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all'

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-border rounded-3xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center"><ReceiptIcon size={17} className="text-accent" /></div>
            <h3 className="font-bold text-foreground text-lg">{past ? 'Complete receipt details' : 'Add receipt'}</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Date + store */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Store (optional)</label>
              <input type="text" placeholder="e.g. Costco" value={store} onChange={e => setStore(e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Image */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Receipt image</label>
            {past ? (
              <p className="text-faint text-xs">Using the receipt image already on this service record.</p>
            ) : imagePreview ? (
              <div className="flex items-center gap-3">
                <img src={imagePreview} alt="" className="w-16 h-16 rounded-xl object-cover border border-border" />
                <button onClick={() => { setImageFile(null); setImagePreview(null) }} className="text-danger text-sm">Remove</button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 text-muted hover:text-accent text-sm">
                <Plus size={14} /> Attach image (optional)
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={pickImage} />
          </div>

          {/* Line items */}
          <div>
            <label className="block text-xs font-medium text-muted mb-2">What was on this receipt</label>
            <div className="space-y-3">
              {lines.map(l => {
                const isNew = !l.productId
                const qtyN = num(l.qty)
                return (
                  <div key={l.key} className="bg-surface-2/50 border border-border rounded-2xl p-3 space-y-2">
                    <div className="flex gap-2">
                      <select value={l.productId} onChange={e => onPickProduct(l.key, e.target.value)} className={`${inputCls} flex-1`}>
                        <option value="">+ New product…</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}
                      </select>
                      {lines.length > 1 && (
                        <button onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} className="w-9 h-9 shrink-0 rounded-xl bg-surface-2 flex items-center justify-center text-muted hover:text-danger transition-colors"><Trash2 size={14} /></button>
                      )}
                    </div>
                    {isNew && (
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" placeholder="Product name *" value={l.newName} onChange={e => patchLine(l.key, { newName: e.target.value })} className={inputCls} />
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
                        {isNew ? (
                          <select value={l.unit} onChange={e => patchLine(l.key, { unit: e.target.value })} className={inputCls}>
                            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        ) : (
                          <input type="text" value={l.unit} disabled className={`${inputCls} opacity-60`} />
                        )}
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">$ / unit</label>
                        <input type="number" inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={e => patchLine(l.key, { unitPrice: e.target.value })} className={inputCls} />
                      </div>
                    </div>
                    {past && qtyN != null && (
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">How much is left now? (optional)</label>
                        <input type="number" inputMode="decimal" placeholder={`${qtyN} = none used yet`} value={l.leftNow} onChange={e => patchLine(l.key, { leftNow: e.target.value })} className={inputCls} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <button onClick={() => setLines(prev => [...prev, emptyLine()])} className="mt-2 flex items-center gap-1.5 text-muted hover:text-accent text-sm transition-colors">
              <Plus size={13} /> Add another product
            </button>
          </div>

          {total > 0 && <p className="text-muted text-sm">Receipt total: <span className="text-foreground font-semibold">${total.toFixed(2)}</span></p>}
          {error && <p className="text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">{error}</p>}
        </div>

        <div className="flex gap-3 px-6 pb-6 pt-2">
          <button onClick={onClose} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={!canSave || saving} className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors">
            {saving ? 'Saving…' : past ? 'Save details' : 'Add receipt'}
          </button>
        </div>
      </div>
    </div>
  )
}
