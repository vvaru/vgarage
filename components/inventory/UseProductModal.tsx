'use client'

import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { X, Wrench, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { withRetry, withTimeout } from '@/lib/recover'
import { fmtQty, fmtNum } from '@/lib/units'
import type { ProductStock, LotBalance } from '@/lib/inventory'

const num = (s: string): number | null => {
  const n = parseFloat(s)
  return s.trim() !== '' && !isNaN(n) ? n : null
}

// Walk the lots oldest-first, taking what's left of each until the amount is met.
export function planDraw(lots: LotBalance[], amount: number): { plan: { lot: LotBalance; qty: number }[]; short: number } {
  const plan: { lot: LotBalance; qty: number }[] = []
  let need = amount
  for (const b of lots) {
    if (need <= 0) break
    const take = Math.min(need, b.remaining)
    if (take > 0) { plan.push({ lot: b, qty: take }); need -= take }
  }
  return { plan, short: Math.max(0, need) }
}

interface Props {
  stock: ProductStock
  lotLabel: (lot: LotBalance) => string
  onClose: () => void
  onSaved: () => void
}

export default function UseProductModal({ stock, lotLabel, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const { vehicle } = useVehicle()

  const [serviceType, setServiceType] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [odometer, setOdometer] = useState('')
  const [amount, setAmount] = useState('1')
  const [laborCost, setLaborCost] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = useRef<{ logId: string; usage: string[] } | null>(null)

  const amountN = num(amount) ?? 0
  const { plan, short } = useMemo(() => planDraw(stock.lots, amountN), [stock.lots, amountN])
  const partsCost = plan.reduce((s, p) => s + p.qty * (p.lot.lot.unitCost ?? 0), 0)
  const labor = num(laborCost) ?? 0
  const canSave = serviceType.trim() !== '' && amountN > 0 && num(odometer) != null

  async function handleSave() {
    if (!user || !vehicle || !canSave) return
    setSaving(true)
    setError(null)
    if (!ids.current) {
      ids.current = { logId: crypto.randomUUID(), usage: plan.map(() => crypto.randomUUID()) }
    }
    const { logId } = ids.current

    try {
      // 1) The service record itself (idempotent on its id).
      const { error: lErr } = await withRetry(() => withTimeout(supabase.from('service_logs').upsert({
        id: logId,
        user_id: user.id,
        vehicle_id: vehicle.id,
        service_type: serviceType.trim(),
        performed_by: 'owner',
        date,
        odometer: num(odometer),
        cost: Math.round((partsCost + labor) * 100) / 100,
        labor_cost: labor > 0 ? labor : null,
        notes: notes.trim() || null,
      }), 9000), 2, 800)
      if (lErr) throw new Error(lErr.message)

      // 2) One usage row per lot the draw touched — that's the FIFO provenance.
      for (let i = 0; i < plan.length; i++) {
        const { lot, qty } = plan[i]
        const { error: uErr } = await withRetry(() => withTimeout(supabase.from('service_product_usage').upsert({
          id: ids.current!.usage[i],
          log_id: logId,
          product_id: stock.product.id,
          // Manual-adjustment lots aren't receipt lines, so they have no lot id to record.
          receipt_item_id: lot.lot.kind === 'receipt' ? lot.lot.id : null,
          qty,
          unit_cost: lot.lot.unitCost,
        }), 9000), 2, 800)
        if (uErr) throw new Error(uErr.message)
      }

      // 3) Attach every receipt the stock came from, so the service shows its paperwork.
      const receiptIds = [...new Set(plan.filter(p => p.lot.lot.kind === 'receipt').map(p => p.lot.lot.sourceId))]
      for (const rid of receiptIds) {
        await withTimeout(supabase.from('service_log_receipts').upsert({ log_id: logId, receipt_id: rid }), 9000)
      }

      onSaved()
    } catch (e) {
      setError(`Couldn’t save (${e instanceof Error ? e.message : String(e)}). Nothing was lost — tap Save to try again.`)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all'

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-border rounded-3xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0"><Wrench size={17} className="text-accent" /></div>
            <div className="min-w-0">
              <h3 className="font-bold text-foreground text-lg truncate">Use {stock.product.name}</h3>
              <p className="text-faint text-xs">{fmtQty(stock.onHand, stock.unit)} on hand</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground shrink-0"><X size={20} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">What was the service? *</label>
            <input type="text" placeholder="e.g. Oil & filter change" value={serviceType} onChange={e => setServiceType(e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Odometer *</label>
              <input type="number" inputMode="numeric" placeholder="miles" value={odometer} onChange={e => setOdometer(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">How much used</label>
              <input type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Labour / shop cost</label>
              <input type="number" inputMode="decimal" placeholder="0.00" value={laborCost} onChange={e => setLaborCost(e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Provenance preview — which lot this draws from, before it's written. */}
          {amountN > 0 && (
            <div className="bg-surface-2/50 border border-border rounded-2xl p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-faint">Drawn from (oldest first)</p>
              {plan.length === 0 && <p className="text-muted text-sm">Nothing in stock to draw from.</p>}
              {plan.map(p => (
                <div key={p.lot.lot.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted truncate flex items-center gap-1.5">
                    <ArrowRight size={12} className="text-faint shrink-0" />{lotLabel(p.lot)}
                  </span>
                  <span className="text-foreground font-medium shrink-0">
                    {fmtQty(p.qty, stock.unit)}
                    {p.lot.lot.unitCost != null && <span className="text-faint font-normal"> · ${(p.qty * p.lot.lot.unitCost).toFixed(2)}</span>}
                  </span>
                </div>
              ))}
              {short > 0 && (
                <p className="text-warn text-xs">
                  {fmtNum(short)} more than you have on record — it'll be logged as used anyway.
                </p>
              )}
              <div className="border-t border-border pt-2 flex items-center justify-between text-sm">
                <span className="text-muted">Parts {partsCost > 0 ? `$${partsCost.toFixed(2)}` : '—'}{labor > 0 ? ` + labour $${labor.toFixed(2)}` : ''}</span>
                <span className="text-foreground font-bold">${(partsCost + labor).toFixed(2)}</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Notes</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} className={`${inputCls} resize-none`} />
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 space-y-3">
          {error && <p className="text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!canSave || saving} className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors">
              {saving ? 'Saving…' : 'Log service'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
