'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Split, Link2, Package, Receipt as ReceiptIcon, X, SlidersHorizontal, Check } from 'lucide-react'
import ServiceFilterPanel from '@/components/service/ServiceFilterPanel'
import { applyServiceFilter, EMPTY_FILTER, isFilterActive, type ServiceFilterState } from '@/lib/serviceFilter'
import { fmtQty, fmtNum } from '@/lib/units'
import { receiptTitle, receiptWhere } from '@/lib/receipts'
import {
  splitMember, suggestExisting, drawsCost,
  type AvailableProduct, type ReceiptDraft, type ServiceGroup, type TagRef,
} from '@/lib/recordDraft'
import type { ServiceLog } from '@/lib/types'

const num = (s: string): number | null => {
  const n = parseFloat(s)
  return s.trim() !== '' && !isNaN(n) ? n : null
}

const inputCls = 'w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all'

interface Props {
  groups: ServiceGroup[]
  setGroups: (next: ServiceGroup[]) => void
  receipts: ReceiptDraft[]
  available: AvailableProduct[]
  logs: ServiceLog[]
}

export default function ServiceStep({ groups, setGroups, receipts, available, logs }: Props) {
  const [picking, setPicking] = useState<string | null>(null)
  const [filter, setFilter] = useState<ServiceFilterState>(EMPTY_FILTER)
  const [showFilters, setShowFilters] = useState(false)

  const receiptByKey = useMemo(() => new Map(receipts.map(r => [r.key, r])), [receipts])
  const allTypes = useMemo(() => [...new Set(logs.map(l => l.service_type))].sort(), [logs])
  const filteredLogs = useMemo(() => applyServiceFilter(logs, filter).slice(0, 40), [logs, filter])

  const patch = (key: string, p: Partial<ServiceGroup>) =>
    setGroups(groups.map(g => g.key === key ? { ...g, ...p } : g))

  function memberLabel(ref: TagRef): string {
    const r = receiptByKey.get(ref.receiptKey)
    if (!r) return 'Receipt'
    const when = r.date ? format(parseISO(r.date), 'MMM d') : 'undated'
    const title = receiptTitle({
      store: r.store,
      products: r.noProducts ? [] : r.lines.map(l =>
        l.newName.trim() || available.find(a => a.key === l.productId)?.name || ''),
      noProducts: r.noProducts,
    }, 2)
    const where = receiptWhere(r.store, when)
    return where && where !== title ? `${title} · ${where}` : title
  }

  function setDraw(groupKey: string, productKey: string, qty: string) {
    const g = groups.find(x => x.key === groupKey)
    if (!g) return
    const rest = g.draws.filter(d => d.productKey !== productKey)
    patch(groupKey, { draws: qty.trim() === '' || parseFloat(qty) <= 0 ? rest : [...rest, { productKey, qty }] })
  }

  if (groups.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-8 flex flex-col items-center justify-center text-center">
        <ReceiptIcon size={36} className="text-faint mb-3" />
        <p className="text-muted font-medium">No services on these receipts</p>
        <p className="text-faint text-sm mt-1 max-w-sm">
          That's fine — the receipts save on their own, and anything without products or
          services is parked under “to import” so you can fill it in later.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
      <p className="text-faint text-xs">
        Receipts naming the same job were merged into one record. Split any that were really separate.
      </p>

      {groups.map(g => {
        const suggestion = g.linkedLogId ? null : suggestExisting(g, logs)
        const linked = g.linkedLogId ? logs.find(l => l.id === g.linkedLogId) : null
        const isDiy = g.performedBy === 'owner'
        // DIY jobs are never charged — what they cost is what the parts cost.
        const partsCost = drawsCost(g.draws, available)
        const effectiveCost = isDiy ? partsCost : (num(g.cost) ?? 0)
        const saving = isDiy && num(g.shopEquivalent) != null
          ? Math.max(0, num(g.shopEquivalent)! - effectiveCost) : null

        return (
          <div key={g.key} className="bg-surface border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-foreground truncate">{g.label}</p>
                <p className="text-faint text-xs">
                  {g.date ? format(parseISO(g.date), 'MMM d, yyyy') : '—'} · {g.performedBy === 'shop' ? 'Shop' : 'DIY'}
                </p>
              </div>
              {g.members.length > 1 && (
                <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border bg-accent/10 text-accent border-accent/20">
                  {g.members.length} receipts merged
                </span>
              )}
            </div>

            {/* What fed this record, and how to undo a wrong merge */}
            <div className="bg-surface-2/50 border border-border rounded-xl divide-y divide-border">
              {g.members.map(m => (
                <div key={`${m.receiptKey}:${m.tagKey}`} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-muted text-xs truncate">{memberLabel(m)}</span>
                  {g.members.length > 1 && (
                    <button onClick={() => setGroups(splitMember(groups, g.key, m))}
                      title="This was actually a separate service"
                      className="flex items-center gap-1 text-faint hover:text-accent text-[11px] shrink-0">
                      <Split size={11} /> Split
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Attach to something already logged */}
            {linked ? (
              <div className="flex items-center justify-between gap-2 bg-accent/5 border border-accent/20 rounded-xl px-3 py-2">
                <span className="min-w-0">
                  <span className="text-foreground text-sm font-medium truncate block">Attaching to “{linked.service_type}”</span>
                  <span className="text-faint text-[11px]">{format(parseISO(linked.date), 'MMM d, yyyy')} · {linked.odometer.toLocaleString()} mi</span>
                </span>
                <button onClick={() => patch(g.key, { linkedLogId: null })} className="text-muted hover:text-foreground text-xs shrink-0">Unlink</button>
              </div>
            ) : (
              <>
                {suggestion && (
                  <div className="bg-warn/5 border border-warn/20 rounded-xl px-3 py-2">
                    <p className="text-foreground text-xs">
                      You already logged <span className="font-semibold">{suggestion.service_type}</span> on{' '}
                      {format(parseISO(suggestion.date), 'MMM d')} at {suggestion.odometer.toLocaleString()} mi.
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => patch(g.key, { linkedLogId: suggestion.id })}
                        className="flex items-center gap-1 bg-accent/10 text-accent border border-accent/20 rounded-lg px-2.5 py-1 text-[11px] font-semibold">
                        <Check size={11} /> Attach to it
                      </button>
                      <span className="text-faint text-[11px] self-center">or leave it to create a new one</span>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">Odometer</label>
                    <input type="number" inputMode="numeric" placeholder="miles" value={g.odometer} onChange={e => patch(g.key, { odometer: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">
                      {isDiy ? 'Parts cost' : 'Charged'}
                    </label>
                    {isDiy ? (
                      <div className="w-full bg-surface-2/40 border border-border rounded-xl px-3 py-2.5 text-sm">
                        <span className={partsCost > 0 ? 'text-foreground font-semibold' : 'text-faint'}>
                          ${partsCost.toFixed(2)}
                        </span>
                        <span className="text-faint text-[11px] ml-1.5">
                          {partsCost > 0 ? 'from parts used' : 'add parts below'}
                        </span>
                      </div>
                    ) : (
                      <input type="number" inputMode="decimal" placeholder="0.00" value={g.cost} onChange={e => patch(g.key, { cost: e.target.value })} className={inputCls} />
                    )}
                  </div>
                </div>
              </>
            )}

            {isDiy && (
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">What a shop would have charged (optional)</label>
                <input type="number" inputMode="decimal" placeholder="0.00" value={g.shopEquivalent} onChange={e => patch(g.key, { shopEquivalent: e.target.value })} className={inputCls} />
                {saving != null && (
                  <p className="text-success text-[11px] mt-1">
                    Saved ${saving.toFixed(2)} doing it yourself{partsCost > 0 ? ` — $${partsCost.toFixed(2)} in parts vs $${num(g.shopEquivalent)!.toFixed(2)}` : ''}.
                  </p>
                )}
              </div>
            )}

            {/* Stock, including what's being bought on these very receipts */}
            {available.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Package size={12} className="text-muted" />
                  <label className="text-[10px] uppercase tracking-wide text-faint">Products used (optional)</label>
                </div>
                <div className="space-y-1.5">
                  {available.map(a => {
                    const drawn = g.draws.find(d => d.productKey === a.key)?.qty ?? ''
                    return (
                      <div key={a.key} className="flex items-center gap-2 bg-surface-2/50 border border-border rounded-xl px-3 py-2">
                        <span className="flex-1 min-w-0">
                          <span className="text-foreground text-sm truncate block">{a.name}</span>
                          <span className="text-faint text-[11px]">
                            {fmtQty(a.onHand, a.unit)} available
                            {a.incoming > 0 && <span className="text-accent"> · {fmtNum(a.incoming)} from these receipts</span>}
                          </span>
                        </span>
                        <input type="number" inputMode="decimal" placeholder="0" value={drawn}
                          onChange={e => setDraw(g.key, a.key, e.target.value)}
                          className="w-20 shrink-0 bg-surface-2 border border-border-strong rounded-lg px-2 py-1.5 text-foreground placeholder-faint text-sm focus:outline-none focus:border-accent/70" />
                      </div>
                    )
                  })}
                </div>
                <p className="text-faint text-[11px] mt-1.5">Leave blank and attach products later — the receipt still links either way.</p>
              </div>
            )}

            <div>
              <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">Notes</label>
              <textarea rows={2} value={g.notes} onChange={e => patch(g.key, { notes: e.target.value })} className={`${inputCls} resize-none`} />
            </div>

            {!linked && (
              <button onClick={() => { setPicking(g.key); setFilter(EMPTY_FILTER) }}
                className="flex items-center gap-1.5 text-muted hover:text-accent text-xs transition-colors">
                <Link2 size={12} /> Attach to a different service I already logged
              </button>
            )}
          </div>
        )
      })}

      {picking && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) setPicking(null) }}>
          <div className="bg-surface border border-border rounded-3xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
              <h4 className="font-bold text-foreground">Attach to an existing service</h4>
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
                <button key={l.id} onClick={() => { patch(picking, { linkedLogId: l.id }); setPicking(null) }}
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
