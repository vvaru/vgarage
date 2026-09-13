'use client'

import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Split, Link2, Package, Receipt as ReceiptIcon, X, SlidersHorizontal, Check, Plus } from 'lucide-react'
import ServiceFilterPanel from '@/components/service/ServiceFilterPanel'
import { applyServiceFilter, EMPTY_FILTER, isFilterActive, type ServiceFilterState } from '@/lib/serviceFilter'
import { fmtQty, fmtNum } from '@/lib/units'
import { receiptTitle, receiptWhere } from '@/lib/receipts'
import ReceiptPreviewPane from './ReceiptPreviewPane'
import {
  splitMember, suggestExisting, drawsCost,
  type AvailableProduct, type ReceiptDraft, type ServiceGroup, type TagRef,
} from '@/lib/recordDraft'
import type { ServiceCategory, ServiceLog } from '@/lib/types'
import { TIRE_POSITIONS, POSITION_LABELS, storedSets, mountedByPosition, type TireLife, type TirePosition } from '@/lib/tires'
import type { TireDraft } from '@/lib/recordDraft'

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
  categories: ServiceCategory[]
  /** Tires you already own, for the fit picker. */
  tireLives?: TireLife[]
  tireProducts?: { id: string; name: string }[]
}

export default function ServiceStep({ groups, setGroups, receipts, available, logs, categories, tireLives = [], tireProducts = [] }: Props) {
  const [picking, setPicking] = useState<string | null>(null)
  const [filter, setFilter] = useState<ServiceFilterState>(EMPTY_FILTER)
  const [showFilters, setShowFilters] = useState(false)
  // Default to the first receipt that actually has something to look at.
  const [previewKey, setPreviewKey] = useState(
    () => (receipts.find(r => r.preview || r.existingImage) ?? receipts[0])?.key ?? '',
  )
  const hasAnyImage = receipts.some(r => r.preview || r.existingImage)

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

  // Rows are added on demand rather than one per product in stock: a garage
  // with thirty products shouldn't render thirty inputs to record using one.
  function addDraw(groupKey: string) {
    const g = groups.find(x => x.key === groupKey)
    if (!g) return
    patch(groupKey, { draws: [...g.draws, { productKey: '', qty: '' }] })
  }
  function updateDraw(groupKey: string, idx: number, p: Partial<{ productKey: string; qty: string }>) {
    const g = groups.find(x => x.key === groupKey)
    if (!g) return
    patch(groupKey, { draws: g.draws.map((d, i) => (i === idx ? { ...d, ...p } : d)) })
  }
  function removeDraw(groupKey: string, idx: number) {
    const g = groups.find(x => x.key === groupKey)
    if (!g) return
    patch(groupKey, { draws: g.draws.filter((_, i) => i !== idx) })
  }

  // Split the picker so "the thing I just bought" is the first thing offered.
  const fromReceipts = available.filter(a => a.incoming > 0)
  const fromStock = available.filter(a => a.incoming === 0)

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
    <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row">
      {/* The paperwork stays on screen while the details get typed */}
      {hasAnyImage && (
        <ReceiptPreviewPane receipts={receipts} activeKey={previewKey} onPick={setPreviewKey} />
      )}

      <div className="flex-1 lg:min-h-0 lg:overflow-y-auto p-6 space-y-4">
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

            {/* What fed this record, and how to undo a wrong merge. Groups carried
                in from an existing link have no members and skip this entirely. */}
            {g.members.length > 0 && (
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
            )}

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
                {g.draws.length > 0 && (
                  <div className="space-y-2">
                    {g.draws.map((d, i) => {
                      const a = available.find(x => x.key === d.productKey)
                      return (
                        <div key={i}>
                          <div className="flex items-center gap-2">
                            <select
                              value={d.productKey}
                              onChange={e => updateDraw(g.key, i, { productKey: e.target.value })}
                              className={`${inputCls} flex-1`}
                            >
                              <option value="">Pick a product…</option>
                              {fromReceipts.length > 0 && (
                                <optgroup label="On these receipts">
                                  {fromReceipts.map(x => <option key={x.key} value={x.key}>{x.name}</option>)}
                                </optgroup>
                              )}
                              {fromStock.length > 0 && (
                                <optgroup label="In inventory">
                                  {fromStock.map(x => <option key={x.key} value={x.key}>{x.name}</option>)}
                                </optgroup>
                              )}
                            </select>
                            <input
                              type="number" inputMode="decimal" placeholder="qty" value={d.qty}
                              onChange={e => updateDraw(g.key, i, { qty: e.target.value })}
                              className="w-20 shrink-0 bg-surface-2 border border-border-strong rounded-xl px-2 py-2.5 text-foreground placeholder-faint text-sm focus:outline-none focus:border-accent/70"
                            />
                            <button
                              onClick={() => removeDraw(g.key, i)}
                              className="w-9 h-9 shrink-0 rounded-xl bg-surface-2 flex items-center justify-center text-muted hover:text-danger transition-colors"
                            ><X size={14} /></button>
                          </div>
                          {a && (
                            <p className="text-faint text-[11px] mt-1">
                              {fmtQty(a.onHand, a.unit)} available
                              {a.incoming > 0 && <span className="text-accent"> · {fmtNum(a.incoming)} from these receipts</span>}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                <button
                  onClick={() => addDraw(g.key)}
                  className="mt-2 flex items-center gap-1.5 text-muted hover:text-accent text-xs transition-colors"
                ><Plus size={12} /> Add a product used</button>
                {g.draws.length === 0 && (
                  <p className="text-faint text-[11px] mt-1.5">Or attach products later — the receipt links either way.</p>
                )}
              </div>
            )}

            {/* Tires: revealed only by a category flagged tracks_tires. Asks the
                way a fitting actually happens — a whole set unless one got damaged —
                and only raises "what about the old ones" when something comes off. */}
            {categories.find(c => c.id === g.categoryId)?.tracks_tires && (() => {
              const td = g.tires
              const setTd = (p: Partial<TireDraft>) => patch(g.key, { tires: { ...td, ...p } })
              const sets = storedSets(tireLives)
              const stored = tireLives.filter(l => !l.mounted && !l.retired)
              const onCar = mountedByPosition(tireLives)
              const corners = (td.scope === 'all' ? [...TIRE_POSITIONS] : td.corners) as TirePosition[]
              const displacing = corners.filter(c => onCar.has(c)).length
              const chip = (on: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                on ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong hover:text-foreground'}`
              const productLabel = tireProducts.find(p => p.id === td.productId)?.name
              const nameOf = (productId: string | null) =>
                (productId && tireProducts.find(p => p.id === productId)?.name) || 'Tires'

              return (
                <div className="bg-accent/5 border border-accent/20 rounded-2xl p-3 space-y-3">
                  <p className="text-[10px] uppercase tracking-wide text-accent font-semibold">Tires</p>

                  <div>
                    <p className="text-muted text-xs mb-1.5">Which tires?</p>
                    <div className="flex gap-1.5">
                      <button onClick={() => setTd({ scope: 'all' })} className={chip(td.scope === 'all')}>All four</button>
                      <button onClick={() => setTd({ scope: 'some' })} className={chip(td.scope === 'some')}>Only some</button>
                    </div>
                    {td.scope === 'some' && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {TIRE_POSITIONS.map(pos => {
                          const on = td.corners.includes(pos)
                          return (
                            <button key={pos} className={chip(on)}
                              onClick={() => setTd({ corners: on ? td.corners.filter(x => x !== pos) : [...td.corners, pos] })}>
                              {POSITION_LABELS[pos]}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-muted text-xs mb-1.5">What went on?</p>
                    <div className="flex gap-1.5">
                      <button onClick={() => setTd({ source: 'new' })} className={chip(td.source === 'new')}>New tires</button>
                      <button onClick={() => setTd({ source: 'storage' })} disabled={stored.length === 0}
                        className={`${chip(td.source === 'storage')} disabled:opacity-40`}
                        title={stored.length === 0 ? 'Nothing in storage yet' : undefined}>From storage</button>
                    </div>
                  </div>

                  {td.source === 'new' && (
                    tireProducts.length === 0 ? (
                      <p className="text-faint text-[11px]">
                        No tire products yet. Add one with type &ldquo;Tires&rdquo; &mdash; it can be a receipt line in step 1.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <select value={td.productId} onChange={e => setTd({ productId: e.target.value })} className={inputCls}>
                          <option value="">Pick the tire…</option>
                          {tireProducts.map(tp => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
                        </select>
                        <input type="number" inputMode="numeric" placeholder="Expected life (mi)" value={td.expectedLife}
                          onChange={e => setTd({ expectedLife: e.target.value })} className={inputCls} />
                      </div>
                    )
                  )}

                  {td.source === 'storage' && td.scope === 'all' && (
                    <select value={td.storedSetKey} onChange={e => setTd({ storedSetKey: e.target.value })} className={inputCls}>
                      <option value="">Pick the set…</option>
                      {sets.map(set => (
                        <option key={set.key} value={set.key}>
                          {nameOf(set.productId)} · {set.tires.length} tire{set.tires.length === 1 ? '' : 's'} · {set.miles.toLocaleString()} mi on them
                        </option>
                      ))}
                    </select>
                  )}

                  {td.source === 'storage' && td.scope === 'some' && td.corners.length > 0 && (
                    <div className="space-y-1.5">
                      {(td.corners as TirePosition[]).map(pos => (
                        <div key={pos} className="flex items-center gap-2">
                          <span className="text-muted text-xs w-20 shrink-0">{POSITION_LABELS[pos]}</span>
                          <select value={td.storedPicks[pos] ?? ''} className={`${inputCls} flex-1`}
                            onChange={e => {
                              const next = { ...td.storedPicks }
                              if (e.target.value) next[pos] = e.target.value
                              else delete next[pos]
                              setTd({ storedPicks: next })
                            }}>
                            <option value="">Pick a stored tire…</option>
                            {stored.map(l => (
                              <option key={l.tire.id} value={l.tire.id}
                                disabled={Object.entries(td.storedPicks).some(([k, v]) => k !== pos && v === l.tire.id)}>
                                {nameOf(l.tire.product_id)} · {l.miles.toLocaleString()} mi
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Only when tires are actually coming off. */}
                  {displacing > 0 && (
                    <div>
                      <p className="text-muted text-xs mb-1.5">
                        {displacing === 4 ? 'The old set' : `The ${displacing} old tire${displacing === 1 ? '' : 's'}`} coming off:
                      </p>
                      <div className="flex gap-1.5">
                        <button onClick={() => setTd({ oldFate: 'scrapped' })} className={chip(td.oldFate === 'scrapped')}>Scrapped</button>
                        <button onClick={() => setTd({ oldFate: 'kept' })} className={chip(td.oldFate === 'kept')}>Kept in storage</button>
                      </div>
                      <p className="text-faint text-[11px] mt-1.5">
                        {td.oldFate === 'scrapped'
                          ? 'They stop being tracked entirely.'
                          : 'They move to storage with their mileage paused, ready to go back on.'}
                      </p>
                    </div>
                  )}

                  {td.source === 'new' && productLabel && corners.length > 0 && (
                    <p className="text-faint text-[11px]">
                      {corners.length === 4 ? 'Four' : corners.length} new {productLabel} go on at the odometer above
                      {displacing > 0 && (td.oldFate === 'scrapped' ? '; the old ones are scrapped' : '; the old ones go to storage')}.
                    </p>
                  )}
                </div>
              )
            })()}

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
      </div>

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
