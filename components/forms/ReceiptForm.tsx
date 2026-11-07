'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { read, withRetry, write } from '@/lib/recover'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { pickable, loadGarage, productLabel, type GarageContext } from '@/lib/formData'
import { emptyLine, withDerivedQty, type LineDraft } from '@/lib/recordDraft'
import { convertProductUnit } from '@/lib/productUnit'
import { fmtQty, guessUnit, UNIT_GROUPS } from '@/lib/units'
import { receiptPath, uploadReceiptFile } from '@/lib/upload'
import {
  Button, Confirm, Dialog, Icon, IconButton, ReadoutField, Segmented, SelectField, Skeleton, TextField,
} from '@/components/ui/md'
import ReceiptViewer from '@/components/ui/ReceiptViewer'
import type { Receipt, ReceiptItem } from '@/lib/types'
import { newId } from '@/lib/newId'

const num = (s: string): number | null => { const n = parseFloat(s); return s.trim() !== '' && !isNaN(n) ? n : null }
const usd = (n: number) => `$${n.toFixed(2)}`

export default function ReceiptForm({ receiptId, onClose, onSaved }: { receiptId?: string; onClose: () => void; onSaved: (m: string) => void }) {
  const { user } = useAuth()
  const { vehicle } = useVehicle()
  const [ctx, setCtx] = useState<GarageContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [store, setStore] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [lines, setLines] = useState<LineDraft[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [convert, setConvert] = useState<{ lineKey: string; productId: string; from: string; to: string; factor: string; busy: boolean; err: string | null } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const ids = useRef<{ receipt: string; keys: Record<string, string> }>({ receipt: receiptId ?? newId(), keys: {} })
  const key = (k: string) => (ids.current.keys[k] ??= newId())

  const load = useCallback(async () => {
    if (!user || !vehicle) return null
    const garage = await loadGarage(user.id, vehicle.id, vehicle.odometer)
    setCtx(garage)
    return garage
  }, [user, vehicle])

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const garage = await load()
        if (!live || !garage) return
        if (!receiptId) { setLines([emptyLine()]); return }
        const { data } = await read(supabase.from('receipts').select('*').eq('id', receiptId).single())
        const r = data as Receipt | null
        if (!live || !r) return
        setDate(r.date ?? format(new Date(), 'yyyy-MM-dd')); setStore(r.store ?? ''); setImage(r.image_path)
        const its = garage.items.filter(i => i.receipt_id === receiptId)
        setLines(its.length ? its.map((it: ReceiptItem) => ({
          ...emptyLine(), key: it.id, itemId: it.id, productId: it.product_id, unitTouched: true,
          unit: garage.products.find(p => p.id === it.product_id)?.unit ?? 'each',
          qty: String(it.qty), unitPrice: it.unit_cost == null ? '' : String(it.unit_cost),
          count: '1', size: String(it.qty), price: it.unit_cost == null ? '' : String(+(Number(it.qty) * Number(it.unit_cost)).toFixed(2)), priceMode: 'total' as const,
        })) : [emptyLine()])
      } catch (e) {
        if (live) setLoadError(e instanceof Error ? e.message : 'Couldn’t load your products.')
      }
    })()
    return () => { live = false }
  }, [load, receiptId])

  // How much of each saved line services have already used: those can't be removed or cut below it.
  const usedOf = (itemId: string | null) => (itemId && ctx ? ctx.usage.filter(u => u.receipt_item_id === itemId).reduce((s, u) => s + Number(u.qty), 0) : 0)
  const usedBy = (itemId: string | null) => {
    if (!itemId || !ctx) return []
    const logIds = [...new Set(ctx.usage.filter(u => u.receipt_item_id === itemId).map(u => u.log_id))]
    return logIds.map(id => ctx.logs.find(l => l.id === id)).filter(Boolean).map(l => `${l!.service_type} (${format(new Date(l!.date + 'T00:00:00'), 'MMM d')})`)
  }
  const patch = (k: string, p: Partial<LineDraft>, derive = true) =>
    setLines(ls => ls.map(l => (l.key === k ? (derive ? withDerivedQty({ ...l, ...p }) : { ...l, ...p }) : l)))

  const active = lines.filter(l => !removed.includes(l.key))
  const total = active.reduce((s, l) => s + (num(l.qty) ?? 0) * (num(l.unitPrice) ?? 0), 0)
  const problems = active.map(l => {
    const used = usedOf(l.itemId)
    if (used > 0 && (num(l.qty) ?? 0) < used - 1e-9) return `${productName(l)}: services already used ${fmtQty(used, l.unit)}.`
    return null
  }).filter(Boolean)
  const valid = active.length > 0 && active.every(l => (l.productId || l.newName.trim()) && (num(l.qty) ?? 0) > 0) && problems.length === 0
  function productName(l: LineDraft) { const p = ctx?.products.find(x => x.id === l.productId); return p ? productLabel(p) : l.newName || 'Item' }

  async function save() {
    if (!user || !ctx) return
    setSaving(true); setError(null)
    const rid = ids.current.receipt
    try {
      await ensureFreshSession()
      const w = async (q: PromiseLike<{ error: { message: string } | null }>, what: string) => {
        const { error: e } = await withRetry(() => write(q), 2, 2500)
        if (e) throw new Error(`${what}: ${e.message}`)
      }
      let path = image
      if (file) {
        path = (ids.current.keys.path ??= receiptPath(user.id, file))
        await uploadReceiptFile(path, file)
      }
      await w(supabase.from('receipts').upsert({ id: rid, user_id: user.id, date, store: store.trim() || null, image_path: path, total_cost: Math.round(total * 100) / 100, no_products: false }), 'Saving the receipt')
      for (const l of active) {
        let pid = l.productId
        if (!pid) {
          pid = key(`prod:${l.key}`)
          await w(supabase.from('products').upsert({ id: pid, user_id: user.id, vehicle_id: null, name: l.newName.trim(), brand: l.newBrand.trim() || null, unit: l.unit || 'each' }), 'Adding a product')
        }
        await w(supabase.from('receipt_items').upsert({ id: l.itemId ?? key(`item:${l.key}`), receipt_id: rid, product_id: pid, qty: num(l.qty), unit_cost: num(l.unitPrice) }), 'Saving an item')
      }
      for (const k of removed) {
        const l = lines.find(x => x.key === k)
        if (l?.itemId) await w(supabase.from('receipt_items').delete().eq('id', l.itemId), 'Removing an item')
      }
      if (file && image && image !== path) await write(supabase.storage.from('receipts').remove([image])).catch(() => {})
      const n = active.length
      onSaved(receiptId ? 'Receipt updated' : `Receipt saved; ${n} item${n === 1 ? '' : 's'} added to stock`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!receiptId) return
    setSaving(true)
    try {
      await ensureFreshSession()
      const { error: e } = await withRetry(() => write(supabase.from('receipts').delete().eq('id', receiptId)), 2, 2500)
      if (e) throw new Error(e.message)
      if (image) await write(supabase.storage.from('receipts').remove([image])).catch(() => {})
      onSaved('Receipt deleted; its items left stock')
    } catch (e) {
      setError(`Couldn’t delete: ${e instanceof Error ? e.message : String(e)}`)
      setSaving(false); setConfirmDelete(false)
    }
  }

  async function runConvert() {
    if (!convert || !ctx) return
    const factor = num(convert.factor)
    if (!factor) return
    setConvert({ ...convert, busy: true, err: null })
    try {
      await convertProductUnit(convert.productId, convert.from, convert.to, factor)
      // The database rescaled what was saved; rescale what's typed here too.
      setLines(ls => ls.map(l => l.productId !== convert.productId ? l : withDerivedQty({ ...l, unit: convert.to, size: String(+((num(l.size) ?? (l.unit === 'each' ? 1 : 0)) * factor).toFixed(4)) })))
      await load()
      setConvert(null)
    } catch (e) {
      setConvert({ ...convert, busy: false, err: e instanceof Error ? e.message : 'Couldn’t change the unit.' })
    }
  }

  const anyUsed = lines.some(l => usedOf(l.itemId) > 0)

  return (
    <>
      <Dialog open onClose={onClose} title={receiptId ? 'Product receipt' : 'Add product receipt'} size="lg"
        subtitle="Parts you bought. They go into stock."
        primary={{ label: 'Save', onClick: save, disabled: !valid || saving, loading: saving }}>
        {!ctx ? (
          loadError ? <p className="type-body text-error">{loadError}</p> : <div className="space-y-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14" />)}</div>
        ) : (
          <div className="flex flex-col gap-5">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={e => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
            {image && !file ? (
              <div className="flex items-start gap-3">
                <div className="w-24 h-28 rounded-xl overflow-hidden bg-surface-container-highest shrink-0"><ReceiptViewer path={image} className="w-full h-full" /></div>
                <div className="flex flex-col gap-1">
                  <Button variant="text" icon="sync" onClick={() => fileRef.current?.click()}>Replace photo</Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex items-center gap-3 rounded-xl border border-dashed border-outline px-4 py-4 text-left hover:bg-surface-container-highest/50 transition-colors">
                <Icon name={file ? 'check_circle' : 'add_a_photo'} size={24} className={file ? 'text-[var(--md-success)]' : 'text-on-surface-variant'} />
                <span className="min-w-0">
                  <span className="block type-body-lg text-on-surface truncate">{file ? file.name : 'Add a photo of the receipt'}</span>
                  <span className="block type-body-sm text-on-surface-variant">{file ? 'Tap to choose a different one' : 'Optional. Photo or PDF.'}</span>
                </span>
              </button>
            )}

            <div className="grid grid-cols-2 gap-3">
              <TextField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
              <TextField label="Store" placeholder="e.g. AutoZone" value={store} onChange={e => setStore(e.target.value)} />
            </div>

            <section className="flex flex-col gap-3">
              <h3 className="type-title-sm text-on-surface-variant flex items-center gap-2"><Icon name="shopping_cart" size={18} />Items</h3>
              {active.map(l => {
                const used = usedOf(l.itemId)
                const isNew = !l.productId
                const qty = num(l.qty), per = num(l.unitPrice)
                return (
                  <div key={l.key} className="rounded-2xl bg-surface-container-highest/60 p-3 sm:p-4 flex flex-col gap-3">
                    <div className="flex items-start gap-2">
                      <SelectField label="Product" className="flex-1" value={l.productId} disabled={used > 0}
                        onChange={e => patch(l.key, { productId: e.target.value, unit: ctx.products.find(p => p.id === e.target.value)?.unit ?? 'each', unitTouched: Boolean(e.target.value) })}>
                        <option value="">New product…</option>
                        {pickable(ctx.products, l.productId).map(p => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                      </SelectField>
                      <IconButton icon="delete" label={used > 0 ? 'Used in a service, can’t remove' : 'Remove item'} disabled={used > 0} className="mt-2"
                        onClick={() => setRemoved(r => [...r, l.key])} />
                    </div>
                    {isNew && (
                      <div className="grid grid-cols-2 gap-3">
                        <TextField label="Product name" value={l.newName} onChange={e => patch(l.key, l.unitTouched ? { newName: e.target.value } : { newName: e.target.value, unit: guessUnit(e.target.value) })} />
                        <TextField label="Brand" placeholder="optional" value={l.newBrand} onChange={e => patch(l.key, { newBrand: e.target.value }, false)} />
                      </div>
                    )}
                    <div className="grid grid-cols-[auto_1fr_1fr] gap-3 items-start">
                      <div className="flex items-center h-14 rounded-[4px] border border-outline">
                        <IconButton icon="remove" label="One fewer" size="sm" onClick={() => patch(l.key, { count: String(Math.max(1, Math.floor(num(l.count) ?? 1) - 1)) })} />
                        <span className="w-8 text-center type-body-lg tabular-nums" aria-label="Count">{l.count || '1'}</span>
                        <IconButton icon="add" label="One more" size="sm" onClick={() => patch(l.key, { count: String(Math.floor(num(l.count) ?? 0) + 1) })} />
                      </div>
                      <TextField label="Size each" type="number" inputMode="decimal" placeholder={l.unit === 'each' ? '1' : undefined} value={l.size} onChange={e => patch(l.key, { size: e.target.value })} />
                      {isNew ? (
                        <SelectField label="Unit" value={l.unit} onChange={e => patch(l.key, { unit: e.target.value, unitTouched: true })}>
                          {UNIT_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.units.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>)}
                        </SelectField>
                      ) : (
                        <button type="button" onClick={() => setConvert({ lineKey: l.key, productId: l.productId, from: l.unit, to: l.unit === 'can' ? 'qt' : l.unit, factor: '', busy: false, err: null })}
                          className="relative h-14 rounded-[4px] bg-surface-container-highest px-4 text-left flex flex-col justify-center hover:bg-surface-container-high" title="Change this product’s unit">
                          <span className="type-body-sm text-on-surface-variant flex items-center gap-1">Unit <Icon name="lock" size={12} /></span>
                          <span className="type-body-lg text-on-surface flex items-center gap-1">{l.unit}<Icon name="edit" size={14} className="text-on-surface-variant" /></span>
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-3 items-center">
                      <TextField label="Price" prefix="$" type="number" inputMode="decimal" value={l.price} onChange={e => patch(l.key, { price: e.target.value })} />
                      <Segmented size="sm" label="Price is" value={l.priceMode} onChange={v => patch(l.key, { priceMode: v })}
                        options={[{ value: 'each', label: 'Per item' }, { value: 'total', label: 'Total' }]} />
                    </div>
                    {qty != null && (
                      <p className="type-body text-on-surface-variant tabular-nums">
                        = <span className="text-on-surface">{fmtQty(qty, l.unit)}</span>
                        {per != null && <> · {usd(qty * per)} · {per < 1 ? `$${per.toFixed(3)}` : usd(per)} per {l.unit === 'each' ? 'item' : l.unit}</>}
                      </p>
                    )}
                    {used > 0 && <p className="type-body-sm text-on-surface-variant flex items-center gap-1"><Icon name="lock" size={14} />{fmtQty(used, l.unit)} already used in {usedBy(l.itemId).join(', ')}</p>}
                  </div>
                )
              })}
              <Button variant="tonal" icon="add" className="self-start" onClick={() => setLines(ls => [...ls, emptyLine()])}>Add item</Button>
            </section>

            <div className="grid grid-cols-2 gap-3">
              <ReadoutField label="Receipt total" value={usd(total)} />
              <div />
            </div>
            {problems.length > 0 && <p className="type-body text-error">{problems.join(' ')}</p>}
            <p className="type-body-sm text-on-surface-variant">A product receipt has no odometer: it’s a purchase, not work on the car. A shop’s bill for a service is added on that service instead.</p>

            {error && (
              <div role="alert" className="flex gap-3 items-start rounded-xl bg-error-container text-on-error-container p-3">
                <Icon name="error" size={20} fill /><p className="type-body min-w-0">{error} Nothing you typed was lost; try Save again.</p>
              </div>
            )}
            {receiptId && (
              <Button variant="danger" icon="delete" className="self-start -ml-2" disabled={anyUsed} onClick={() => setConfirmDelete(true)}>
                {anyUsed ? 'Can’t delete: items were used in services' : 'Delete this receipt'}
              </Button>
            )}
          </div>
        )}
      </Dialog>

      <Dialog open={Boolean(convert)} onClose={() => setConvert(null)} title="Change unit" variant="basic" size="sm"
        primary={convert ? { label: 'Convert', onClick: runConvert, disabled: !num(convert.factor) || convert.to === convert.from, loading: convert.busy } : undefined}>
        {convert && (
          <div className="flex flex-col gap-4">
            <p>Stock for this product is counted in <b>{convert.from}</b>. Converting rescales everything already logged for it, so the amounts stay right.</p>
            <div className="grid grid-cols-[auto_1fr_1fr] gap-3 items-center">
              <span className="type-body-lg text-on-surface whitespace-nowrap">1 {convert.from} =</span>
              <TextField label="How many" type="number" inputMode="decimal" value={convert.factor} onChange={e => setConvert({ ...convert, factor: e.target.value, err: null })} />
              <SelectField label="New unit" value={convert.to} onChange={e => setConvert({ ...convert, to: e.target.value, err: null })}>
                {UNIT_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.units.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>)}
              </SelectField>
            </div>
            {(() => {
              const s = ctx?.stock.get(convert.productId), f = num(convert.factor)
              return s && f && convert.to !== convert.from ? <p>Your {fmtQty(s.onHand, convert.from)} on hand becomes {fmtQty(+(s.onHand * f).toFixed(4), convert.to)}.</p> : null
            })()}
            {convert.err && <p className="text-error">{convert.err}</p>}
          </div>
        )}
      </Dialog>

      <Confirm open={confirmDelete} title="Delete this receipt?" confirmLabel="Delete" danger busy={saving}
        onCancel={() => setConfirmDelete(false)} onConfirm={remove}
        body="Its items leave stock. Services aren’t affected: nothing on this receipt was used yet." />
    </>
  )
}
