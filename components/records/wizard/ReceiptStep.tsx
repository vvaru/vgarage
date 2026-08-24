'use client'

import { useRef, useState } from 'react'
import { Plus, Trash2, Package, Wrench, ChevronDown, ChevronRight, Link as LinkIcon, X } from 'lucide-react'
import ReceiptPreviewPane from './ReceiptPreviewPane'
import { UNIT_GROUPS, guessUnit, fmtQty } from '@/lib/units'
import { emptyLine, emptyTag, type LineDraft, type ReceiptDraft, type ServiceTag } from '@/lib/recordDraft'
import type { Product, ServiceCategory } from '@/lib/types'
import type { ProductStock } from '@/lib/inventory'

type ProductU = Product & { unit?: string }

const num = (s: string): number | null => {
  const n = parseFloat(s)
  return s.trim() !== '' && !isNaN(n) ? n : null
}

interface Props {
  draft: ReceiptDraft
  products: ProductU[]
  categories: ServiceCategory[]
  stock?: Map<string, ProductStock>
  lockedItemIds?: Set<string>
  onPatch: (patch: Partial<ReceiptDraft>) => void
}

const inputCls = 'w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all'

export default function ReceiptStep({ draft, products, categories, stock, lockedItemIds, onPatch }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [openDetails, setOpenDetails] = useState<Set<string>>(new Set())
  const toggleDetails = (key: string) => setOpenDetails(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const patchLine = (key: string, patch: Partial<LineDraft>) =>
    onPatch({ lines: draft.lines.map(l => l.key === key ? { ...l, ...patch } : l) })
  const patchTag = (key: string, patch: Partial<ServiceTag>) =>
    onPatch({ tags: draft.tags.map(t => t.key === key ? { ...t, ...patch } : t) })

  function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    onPatch({ file: f, preview: URL.createObjectURL(f) })
    e.target.value = ''
  }

  const partsTotal = draft.lines.reduce((s, l) => s + (num(l.qty) ?? 0) * (num(l.unitPrice) ?? 0), 0)
  const svcTotal = draft.tags.reduce((s, t) => s + (num(t.amount) ?? 0), 0)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col lg:flex-row">
      <ReceiptPreviewPane
        receipts={[draft]}
        activeKey={draft.key}
        onPick={() => {}}
        onAttach={() => fileRef.current?.click()}
        onRemove={() => onPatch({ file: null, preview: null })}
      />

      {/* What's printed on it */}
      <div className="flex-1 lg:min-h-0 lg:overflow-y-auto p-6 space-y-5">
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={pickImage} />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Date</label>
            <input type="date" value={draft.date} onChange={e => onPatch({ date: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Store / shop</label>
            <input type="text" placeholder="e.g. Costco" value={draft.store} onChange={e => onPatch({ store: e.target.value })} className={inputCls} />
          </div>
        </div>

        <label className="flex items-start gap-2.5 bg-surface-2/50 border border-border rounded-2xl p-3 cursor-pointer">
          <input type="checkbox" checked={draft.noProducts} onChange={e => onPatch({ noProducts: e.target.checked })} className="mt-0.5 accent-[var(--color-accent)]" />
          <span>
            <span className="text-foreground text-sm font-medium block">No products on this receipt</span>
            <span className="text-faint text-xs">Labour or services only.</span>
          </span>
        </label>

        {/* Products */}
        {!draft.noProducts && (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Package size={13} className="text-muted" />
              <label className="text-xs font-medium text-muted">Products on this receipt</label>
            </div>
            <div className="space-y-3">
              {draft.lines.map(l => {
                const isNew = !l.productId
                const locked = Boolean(l.itemId && lockedItemIds?.has(l.itemId))
                const s = stock?.get(l.productId)
                return (
                  <div key={l.key} className="bg-surface-2/50 border border-border rounded-2xl p-3 space-y-2">
                    <div className="flex gap-2">
                      <select value={l.productId}
                        onChange={e => patchLine(l.key, { productId: e.target.value, unit: products.find(p => p.id === e.target.value)?.unit ?? 'each' })}
                        className={`${inputCls} flex-1`}>
                        <option value="">+ New product…</option>
                        {products.map(p => <option key={p.id} value={p.id}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}
                      </select>
                      {draft.lines.length > 1 && (
                        <button onClick={() => onPatch({ lines: draft.lines.filter(x => x.key !== l.key) })} disabled={locked}
                          title={locked ? 'Already used in a service — can’t remove' : 'Remove line'}
                          className="w-9 h-9 shrink-0 rounded-xl bg-surface-2 flex items-center justify-center text-muted hover:text-danger disabled:opacity-30 transition-colors"><Trash2 size={14} /></button>
                      )}
                    </div>
                    {isNew && (
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" placeholder="Product name *" value={l.newName}
                          onChange={e => patchLine(l.key, l.unitTouched ? { newName: e.target.value } : { newName: e.target.value, unit: guessUnit(e.target.value) })}
                          className={inputCls} />
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
                    {s && <p className="text-faint text-[11px]">Currently {fmtQty(s.onHand, s.unit)} on hand.</p>}

                    {/* Catalogue detail for a product being created. Folded away —
                        a receipt shouldn't demand a buy link before it'll save. */}
                    {isNew && l.newName.trim() && (
                      <div className="pt-1">
                        <button onClick={() => toggleDetails(l.key)}
                          className="flex items-center gap-1 text-faint hover:text-accent text-[11px] transition-colors">
                          {openDetails.has(l.key) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          Catalogue details {openDetails.has(l.key) ? '' : '(optional)'}
                        </button>
                        {openDetails.has(l.key) && (
                          <div className="mt-2 space-y-2">
                            <div className="relative">
                              <LinkIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                              <input type="url" placeholder="Where to buy it again" value={l.newBuyUrl}
                                onChange={e => patchLine(l.key, { newBuyUrl: e.target.value })}
                                className={`${inputCls} pl-9`} />
                            </div>
                            <textarea rows={2} placeholder="Part number, specs, fitment notes…" value={l.newNotes}
                              onChange={e => patchLine(l.key, { newNotes: e.target.value })}
                              className={`${inputCls} resize-none`} />
                            {categories.length > 0 && (
                              <div>
                                {/* Dropdown rather than a chip grid — most products
                                    need one category, and the list can be long. */}
                                <select value="" onChange={e => {
                                  if (!e.target.value) return
                                  patchLine(l.key, { newCategoryIds: [...new Set([...l.newCategoryIds, e.target.value])] })
                                }} className={inputCls}>
                                  <option value="">Used for… (optional)</option>
                                  {categories.filter(c => !l.newCategoryIds.includes(c.id))
                                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                                {l.newCategoryIds.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {l.newCategoryIds.map(id => (
                                      <button key={id}
                                        onClick={() => patchLine(l.key, { newCategoryIds: l.newCategoryIds.filter(x => x !== id) })}
                                        className="flex items-center gap-1 bg-accent/10 text-accent border border-accent/20 rounded-lg px-2 py-0.5 text-[11px] font-medium hover:bg-accent/20 transition-colors">
                                        {categories.find(c => c.id === id)?.name ?? 'Category'}
                                        <X size={9} />
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <button onClick={() => onPatch({ lines: [...draft.lines, emptyLine()] })} className="mt-2 flex items-center gap-1.5 text-muted hover:text-accent text-sm transition-colors">
              <Plus size={13} /> Add another product
            </button>
          </div>
        )}

        {/* Services named on the receipt — identity only; details come next step */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Wrench size={13} className="text-muted" />
            <label className="text-xs font-medium text-muted">Services this receipt relates to</label>
          </div>
          <div className="space-y-3">
            {draft.tags.map(t => (
              <div key={t.key} className="bg-surface-2/50 border border-border rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex gap-1.5">
                    {(['shop', 'owner'] as const).map(p => (
                      <button key={p} onClick={() => patchTag(t.key, { performedBy: p })}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                          t.performedBy === p ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong'
                        }`}>{p === 'shop' ? 'Shop' : 'DIY'}</button>
                    ))}
                  </div>
                  <button onClick={() => onPatch({ tags: draft.tags.filter(x => x.key !== t.key) })}
                    className="w-8 h-8 rounded-xl bg-surface-2 flex items-center justify-center text-muted hover:text-danger transition-colors"><Trash2 size={13} /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={t.categoryId} onChange={e => patchTag(t.key, { categoryId: e.target.value })} className={inputCls}>
                    <option value="">Pick a category…</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input type="text" placeholder="or type a name" value={t.customName} onChange={e => patchTag(t.key, { customName: e.target.value })} className={inputCls} />
                </div>
                {/* Only shop work is billed here. DIY has no line on the receipt —
                    the receipt gets attached to your job, not the other way round. */}
                {t.performedBy === 'shop' ? (
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-faint mb-1">Charged on this receipt</label>
                    <input type="number" inputMode="decimal" placeholder="0.00" value={t.amount} onChange={e => patchTag(t.key, { amount: e.target.value })} className={inputCls} />
                  </div>
                ) : (
                  <p className="text-faint text-[11px]">
                    Your own work — nothing was charged for it. This receipt gets attached to the job,
                    and its cost comes from the parts you used.
                  </p>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => onPatch({ tags: [...draft.tags, emptyTag()] })} className="mt-2 flex items-center gap-1.5 text-muted hover:text-accent text-sm transition-colors">
            <Plus size={13} /> Add a service
          </button>
          <p className="text-faint text-[11px] mt-2">
            Shop work is billed on the receipt. DIY work isn’t — the receipt just links to it.
            Odometer, notes and products used come next.
          </p>
        </div>

        {(partsTotal > 0 || svcTotal > 0) && (
          <p className="text-muted text-sm">
            Receipt total: <span className="text-foreground font-semibold">${(partsTotal + svcTotal).toFixed(2)}</span>
            {partsTotal > 0 && svcTotal > 0 && (
              <span className="text-faint"> · ${partsTotal.toFixed(2)} parts + ${svcTotal.toFixed(2)} services</span>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
