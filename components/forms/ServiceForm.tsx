'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { format } from 'date-fns'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { read, withRetry, write } from '@/lib/recover'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { pickable, loadGarage, lotSource, productLabel, type GarageContext } from '@/lib/formData'
import { checkOdometer, odometerProblem } from '@/lib/odometer'
import { useOdometerPoints } from '@/lib/useOdometerPoints'
import { planDraw, type LotBalance } from '@/lib/inventory'
import { fmtQty, guessUnit, UNIT_GROUPS } from '@/lib/units'
import { TIRE_POSITIONS, planFitting, storedSets, type TirePosition } from '@/lib/tires'
import { emptyTireDraft, type TireDraft } from '@/lib/recordDraft'
import { receiptPath, uploadReceiptFile } from '@/lib/upload'
import {
  Avatar, Button, Confirm, Dialog, Icon, IconButton, ListItem, ReadoutField, Segmented, SelectField, Skeleton, Tabs, TextArea, TextField,
} from '@/components/ui/md'
import TireFitting from './TireFitting'
import type { ServiceLog } from '@/lib/types'
import { newId } from '@/lib/newId'

const ImageCropModal = dynamic(() => import('@/components/service/ImageCropModal'), { ssr: false })

const num = (s: string): number | null => { const n = parseFloat(s); return s.trim() !== '' && !isNaN(n) ? n : null }
const usd = (n: number) => `$${n.toFixed(2)}`
const today = () => format(new Date(), 'yyyy-MM-dd')

interface Fresh { store: string; date: string; bought: string; price: string; newName: string; newUnit: string }
interface PartRow { key: string; productId: string; qty: string; fresh?: Fresh }
interface Bill { receiptId: string; label: string; image: string | null }
interface Upload { key: string; file: File }

export default function ServiceForm({ logId, productId, categoryId, onClose, onSaved }: {
  logId?: string
  productId?: string
  categoryId?: string
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { user } = useAuth()
  const { vehicle } = useVehicle()
  const [ctx, setCtx] = useState<GarageContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [original, setOriginal] = useState<ServiceLog | null>(null)

  const [date, setDate] = useState(today())
  const [odo, setOdo] = useState('')
  const [catId, setCatId] = useState(categoryId ?? '')
  const [customName, setCustomName] = useState('')
  const [who, setWho] = useState<'owner' | 'shop'>('owner')
  const [charged, setCharged] = useState('')
  const [shopName, setShopName] = useState('')
  const [shopEquivalent, setShopEquivalent] = useState('')
  const [notes, setNotes] = useState('')
  const [parts, setParts] = useState<PartRow[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [removedBills, setRemovedBills] = useState<string[]>([])
  const [uploads, setUploads] = useState<Upload[]>([])
  // A photo goes through the crop step first; a PDF is attached as it is.
  const [toCrop, setToCrop] = useState<File | null>(null)
  const attach = (f: File) => setUploads(us => [...us, { key: newId(), file: f }])
  const [legacyReceipt, setLegacyReceipt] = useState<string | null>(null)
  const [dropLegacy, setDropLegacy] = useState(false)
  const [tires, setTires] = useState<TireDraft>(emptyTireDraft())
  const [picker, setPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // The record's id is fixed for this form session, so a retried save rewrites the same rows.
  const [recordId] = useState(() => logId ?? newId())
  const ids = useRef<{ keys: Record<string, string> }>({ keys: {} })
  const key = (k: string) => (ids.current.keys[k] ??= newId())
  const odoPoints = useOdometerPoints(vehicle?.id)

  // ── Load what the form needs; when editing, the service as it was saved ──
  useEffect(() => {
    if (!user || !vehicle) return
    let live = true
    ;(async () => {
      try {
        const garage = await loadGarage(user.id, vehicle.id, vehicle.odometer, logId)
        if (!live) return
        setCtx(garage)
        if (!logId) {
          setOdo(String(vehicle.odometer))
          if (productId) setParts([{ key: newId(), productId, qty: '1' }])
          if (productId && !categoryId) {
            const link = garage.links.find(l => l.product_id === productId && garage.categories.some(c => c.id === l.category_id))
            if (link) setCatId(link.category_id)
          }
          return
        }
        const [{ data: log }, { data: links }] = await Promise.all([
          read(supabase.from('service_logs').select('*').eq('id', logId).single()),
          read(supabase.from('service_log_receipts').select('*').eq('log_id', logId)),
        ])
        if (!live || !log) return
        const l = log as ServiceLog
        setOriginal(l)
        setDate(l.date); setOdo(String(l.odometer || ''))
        setCatId(l.category_id ?? ''); setCustomName(l.category_id ? '' : l.service_type)
        setWho(l.performed_by === 'shop' ? 'shop' : 'owner')
        setShopName(l.shop_name ?? ''); setNotes(l.notes ?? '')
        setShopEquivalent(l.shop_equivalent_cost != null ? String(l.shop_equivalent_cost) : '')
        setLegacyReceipt(l.receipt_url)
        const used = garage.usage.filter(u => u.log_id === logId)
        const byProduct = new Map<string, number>()
        for (const u of used) byProduct.set(u.product_id, (byProduct.get(u.product_id) ?? 0) + Number(u.qty))
        setParts([...byProduct].map(([pid, q]) => ({ key: newId(), productId: pid, qty: String(+q.toFixed(3)) })))
        const partsCost = used.reduce((s, u) => s + Number(u.qty) * Number(u.unit_cost ?? 0), 0)
        if (l.performed_by === 'shop' && l.cost != null) setCharged(String(+(Number(l.cost) - partsCost).toFixed(2)))
        const linked = ((links ?? []) as { receipt_id: string }[]).map(x => garage.receipts.get(x.receipt_id)).filter(Boolean)
        setBills(linked.filter(r => r!.no_products || !garage.items.some(i => i.receipt_id === r!.id))
          .map(r => ({ receiptId: r!.id, label: [r!.store || 'Shop bill', r!.date ? format(new Date(r!.date + 'T00:00:00'), 'MMM d, yyyy') : null].filter(Boolean).join(' · '), image: r!.image_path })))
      } catch (e) {
        if (live) setLoadError(e instanceof Error ? e.message : 'Couldn’t load your parts and categories.')
      }
    })()
    return () => { live = false }
  }, [user, vehicle, logId, productId, categoryId])

  const cat = ctx?.categories.find(c => c.id === catId) ?? null
  const isShop = who === 'shop'

  // ── Plan every stock part oldest-lot-first, in row order, so two rows of the
  //    same product don't both count the same lot. ──
  const planned = useMemo(() => {
    const out = new Map<string, { plan: { lot: LotBalance; qty: number }[]; short: number; cost: number; source: string }>()
    if (!ctx) return out
    const left = new Map<string, number>()
    for (const row of parts) {
      const q = num(row.qty) ?? 0
      if (row.fresh) {
        const bought = num(row.fresh.bought) ?? 0, price = num(row.fresh.price) ?? 0
        out.set(row.key, { plan: [], short: 0, cost: bought > 0 ? (price / bought) * q : 0, source: `New receipt · ${row.fresh.store || 'store'}` })
        continue
      }
      const lots = (ctx.stock.get(row.productId)?.lots ?? [])
        .map(b => ({ ...b, remaining: left.get(b.lot.id) ?? b.remaining }))
        .filter(b => b.remaining > 0)
      const { plan, short } = planDraw(lots, q)
      for (const p of plan) left.set(p.lot.lot.id, (left.get(p.lot.lot.id) ?? p.lot.remaining) - p.qty)
      const sources = [...new Set(plan.map(p => lotSource(ctx, p.lot.lot.id)))]
      out.set(row.key, {
        plan, short,
        cost: plan.reduce((s, p) => s + p.qty * (p.lot.lot.unitCost ?? 0), 0),
        source: sources.length === 0 ? 'Not in stock' : sources.length === 1 ? sources[0] : `${sources[0]} and ${sources.length - 1} more`,
      })
    }
    return out
  }, [ctx, parts])

  const partsCost = [...planned.values()].reduce((s, p) => s + p.cost, 0)
  const chargedN = num(charged)
  const totalCost = isShop ? (chargedN != null ? chargedN + partsCost : (partsCost || null)) : (parts.length ? partsCost : null)
  const saving$ = !isShop && num(shopEquivalent) != null && parts.length ? num(shopEquivalent)! - partsCost : null
  const odoN = num(odo)
  const odoWarning = odoPoints && odoN ? odometerProblem(odoPoints, date, odoN, [recordId]) : null
  const name = (cat?.name ?? customName).trim()
  const canSave = Boolean(ctx && date && odoN && name && !odoWarning && !saving)
  const tiresOn = Boolean(cat?.tracks_tires && !logId)

  function addPart(row: Omit<PartRow, 'key'>) { setParts(p => [...p, { ...row, key: newId() }]) }

  // ── Save ──────────────────────────────────────────────────────────────
  async function save() {
    if (!user || !vehicle || !ctx || !odoN || !name) return
    setSaving(true); setError(null)
    const logIdNow = recordId
    try {
      await ensureFreshSession()
      const problem = await checkOdometer(vehicle.id, date, odoN, [logIdNow])
      if (problem) throw new Error(problem)
      const w = async (q: PromiseLike<{ error: { message: string } | null }>, what: string) => {
        const { error: e } = await withRetry(() => write(q), 2, 2500)
        if (e) throw new Error(`${what}: ${e.message}`)
      }

      // Parts bought for this job: product (if new), receipt, line → a lot to draw from.
      const freshLots = new Map<string, { itemId: string; productId: string; unitCost: number }>()
      for (const row of parts) {
        if (!row.fresh) continue
        const f = row.fresh
        let pid = row.productId
        if (!pid) {
          pid = key(`prod:${row.key}`)
          await w(supabase.from('products').upsert({ id: pid, user_id: user.id, vehicle_id: null, name: f.newName.trim(), brand: null, unit: f.newUnit || guessUnit(f.newName) }), 'Adding the product')
        }
        const rid = key(`rcpt:${row.key}`), iid = key(`item:${row.key}`)
        const bought = num(f.bought) ?? 0, price = num(f.price) ?? 0
        await w(supabase.from('receipts').upsert({ id: rid, user_id: user.id, date: f.date || date, store: f.store.trim() || null, no_products: false }), 'Saving the receipt')
        await w(supabase.from('receipt_items').upsert({ id: iid, receipt_id: rid, product_id: pid, qty: bought, unit_cost: bought > 0 ? price / bought : null }), 'Saving the receipt line')
        freshLots.set(row.key, { itemId: iid, productId: pid, unitCost: bought > 0 ? price / bought : 0 })
      }

      const fields = {
        service_type: name, category_id: cat?.id ?? null, record_type: cat?.category_type ?? 'maintenance',
        performed_by: who, shop_name: isShop ? (shopName.trim() || null) : null,
        date, odometer: odoN, cost: totalCost != null ? Math.round(totalCost * 100) / 100 : null,
        shop_equivalent_cost: isShop ? null : num(shopEquivalent), notes: notes.trim() || null,
        ...(dropLegacy ? { receipt_url: null } : {}),
      }
      if (logId) await w(supabase.from('service_logs').update(fields).eq('id', logIdNow), 'Saving the service')
      else await w(supabase.from('service_logs').upsert({ id: logIdNow, user_id: user.id, vehicle_id: vehicle.id, ...fields }), 'Saving the service')

      // Parts used: replace this service's usage with the plan above.
      if (logId) await w(supabase.from('service_product_usage').delete().eq('log_id', logIdNow), 'Updating parts')
      for (const row of parts) {
        const q = num(row.qty)
        if (!q || q <= 0) continue
        const fresh = freshLots.get(row.key)
        if (fresh) {
          await w(supabase.from('service_product_usage').upsert({ id: key(`use:${row.key}:fresh`), log_id: logIdNow, product_id: fresh.productId, receipt_item_id: fresh.itemId, qty: q, unit_cost: fresh.unitCost }), 'Saving a part')
          continue
        }
        const p = planned.get(row.key)!
        for (const step of p.plan) {
          const lot = step.lot.lot
          await w(supabase.from('service_product_usage').upsert({
            id: key(`use:${row.key}:${lot.id}`), log_id: logIdNow, product_id: row.productId,
            receipt_item_id: lot.kind === 'receipt' ? lot.id : null, qty: step.qty, unit_cost: lot.unitCost,
          }), 'Saving a part')
        }
        if (p.short > 0) {
          await w(supabase.from('service_product_usage').upsert({ id: key(`use:${row.key}:short`), log_id: logIdNow, product_id: row.productId, receipt_item_id: null, qty: p.short, unit_cost: null }), 'Saving a part')
        }
      }

      // Service receipts (shop bills).
      for (const rid of removedBills) {
        await w(supabase.from('service_log_receipts').delete().eq('log_id', logIdNow).eq('receipt_id', rid), 'Removing a receipt')
        const r = ctx.receipts.get(rid)
        if (r && !ctx.items.some(i => i.receipt_id === rid)) {
          await w(supabase.from('receipts').delete().eq('id', rid), 'Removing a receipt')
          if (r.image_path) await write(supabase.storage.from('receipts').remove([r.image_path])).catch(() => {})
        }
      }
      for (const u of uploads) {
        const path = (ids.current.keys[`path:${u.key}`] ??= receiptPath(user.id, u.file))
        await uploadReceiptFile(path, u.file)
        const rid = key(`bill:${u.key}`)
        await w(supabase.from('receipts').upsert({ id: rid, user_id: user.id, date, store: shopName.trim() || null, image_path: path, total_cost: chargedN, no_products: true }), 'Saving the bill')
        await w(supabase.from('service_log_receipts').upsert({ log_id: logIdNow, receipt_id: rid }), 'Attaching the bill')
      }
      if (dropLegacy && legacyReceipt) await write(supabase.storage.from('receipts').remove([legacyReceipt])).catch(() => {})

      if (tiresOn) await saveTires(logIdNow, odoN)

      // Using a product for a categorised service says what it's for.
      if (cat) {
        for (const row of parts) {
          const pid = freshLots.get(row.key)?.productId ?? row.productId
          if (pid && !ctx.links.some(l => l.product_id === pid && l.category_id === cat.id)) {
            await write(supabase.from('product_category_links').upsert({ product_id: pid, category_id: cat.id })).catch(() => {})
          }
        }
      }
      if (odoN > vehicle.odometer) await write(supabase.from('vehicles').update({ odometer: odoN }).eq('id', vehicle.id)).catch(() => {})
      onSaved(logId ? 'Service updated' : `${name} saved`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function saveTires(logIdNow: string, odometer: number) {
    if (!user || !vehicle || !ctx) return
    const td = tires
    const wants = td.source === 'new' ? Boolean(td.productId) : td.scope === 'all' ? Boolean(td.storedSetKey) : Object.keys(td.storedPicks).length > 0
    if (!wants) return
    const corners = (td.scope === 'all' ? [...TIRE_POSITIONS] : td.corners).filter((c): c is TirePosition => (TIRE_POSITIONS as readonly string[]).includes(c))
    const incoming: Partial<Record<TirePosition, string>> = {}
    if (td.source === 'new') for (const c of corners) incoming[c] = 'new'
    else if (td.scope === 'all') storedSets(ctx.tireLives).find(x => x.key === td.storedSetKey)?.tires.slice(0, 4).forEach((l, i) => { incoming[TIRE_POSITIONS[i]] = l.tire.id })
    else for (const c of corners) if (td.storedPicks[c]) incoming[c] = td.storedPicks[c]
    const plan = planFitting(ctx.tireLives, incoming, td.oldFate)
    const life = num(td.expectedLife)
    const w = async (q: PromiseLike<{ error: { message: string } | null }>) => { const { error: e } = await withRetry(() => write(q), 2, 2500); if (e) throw new Error(`Saving the tires: ${e.message}`) }
    for (const m of plan.mounts) {
      let tireId = m.tireId
      if (!tireId) {
        tireId = key(`tire:new:${m.position}`)
        await w(supabase.from('tires').upsert({ id: tireId, user_id: user.id, product_id: td.productId, expected_life_miles: life, purchased_date: date }))
      }
      await w(supabase.from('tire_events').upsert({ id: key(`tire:on:${m.position}`), user_id: user.id, vehicle_id: vehicle.id, tire_id: tireId, log_id: logIdNow, position: m.position, odometer, date }))
    }
    for (const o of plan.offs) {
      await w(supabase.from('tire_events').upsert({ id: key(`tire:off:${o.tireId}`), user_id: user.id, vehicle_id: vehicle.id, tire_id: o.tireId, log_id: logIdNow, position: null, odometer, date }))
      if (o.fate === 'scrapped') await w(supabase.from('tires').update({ retired_date: date, retired_reason: 'Replaced' }).eq('id', o.tireId))
    }
  }

  async function remove() {
    if (!logId || !ctx) return
    setSaving(true)
    try {
      await ensureFreshSession()
      for (const b of bills) {
        await write(supabase.from('receipts').delete().eq('id', b.receiptId))
        if (b.image) await write(supabase.storage.from('receipts').remove([b.image])).catch(() => {})
      }
      const { error: e } = await withRetry(() => write(supabase.from('service_logs').delete().eq('id', logId)), 2, 2500)
      if (e) throw new Error(e.message)
      if (legacyReceipt) await write(supabase.storage.from('receipts').remove([legacyReceipt])).catch(() => {})
      onSaved('Service deleted. Its parts went back into stock.')
    } catch (e) {
      setError(`Couldn’t delete: ${e instanceof Error ? e.message : String(e)}`)
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  const unitOf = (pid: string) => ctx?.products.find(p => p.id === pid)?.unit ?? 'each'

  return (
    <>
      <Dialog open onClose={onClose} title={logId ? 'Edit service' : 'Log service'} size="lg"
        subtitle={logId && original ? `${original.service_type} · ${format(new Date(original.date + 'T00:00:00'), 'MMM d, yyyy')}` : undefined}
        primary={{ label: 'Save', onClick: save, disabled: !canSave, loading: saving }}>
        {!ctx ? (
          loadError ? <p className="type-body text-error">{loadError}</p> : <div className="space-y-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
              <TextField label="Odometer" suffix="mi" type="number" inputMode="numeric" value={odo} onChange={e => setOdo(e.target.value)}
                error={odoWarning ?? undefined} helper={!odoWarning ? (odoN ? 'Fits the readings around this date' : 'Every service needs one') : undefined} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectField label="What was done" value={catId} onChange={e => setCatId(e.target.value)}>
                <option value="">Something else…</option>
                {ctx.categories.filter(c => c.is_visible !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
              {!catId && <TextField label="Name it" placeholder="e.g. Battery replacement" value={customName} onChange={e => setCustomName(e.target.value)} />}
            </div>

            <Segmented label="Who did the work" className="w-full" value={who} onChange={setWho}
              options={[{ value: 'shop', label: 'Shop', icon: 'storefront' }, { value: 'owner', label: 'DIY', icon: 'handyman' }]} />

            {isShop && (
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Charged" prefix="$" type="number" inputMode="decimal" value={charged} onChange={e => setCharged(e.target.value)} />
                <TextField label="Shop" placeholder="e.g. Honda of Bay Ridge" value={shopName} onChange={e => setShopName(e.target.value)} />
              </div>
            )}

            {/* Parts */}
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="type-title-sm text-on-surface-variant flex items-center gap-2"><Icon name="inventory_2" size={18} />{isShop ? 'Your parts the shop used' : 'Parts used'}</h3>
                {!isShop && partsCost > 0 && <span className="type-label-lg text-on-surface tabular-nums">{usd(partsCost)}</span>}
              </div>
              {parts.length === 0 && <p className="type-body text-on-surface-variant">{isShop ? 'Only if you brought your own parts.' : 'Add the parts from your stock, or ones you just bought.'}</p>}
              {parts.map((row, i) => {
                const prod = ctx.products.find(p => p.id === row.productId)
                const p = planned.get(row.key)
                const unit = row.fresh && !row.productId ? (row.fresh.newUnit || 'each') : unitOf(row.productId)
                return (
                  <div key={row.key} className="flex items-center gap-3 rounded-xl bg-surface-container-highest/70 pl-4 pr-1 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="type-body-lg text-on-surface truncate">{prod ? productLabel(prod) : row.fresh?.newName || 'Product'}</p>
                      <p className={`type-body-sm flex items-center gap-1 truncate ${p?.short ? 'text-error' : 'text-primary'}`}>
                        <Icon name={p?.short ? 'warning' : row.fresh || p?.plan.some(x => x.lot.lot.kind === 'receipt') ? 'receipt_long' : 'inventory_2'} size={14} />
                        {p?.short ? `Only ${fmtQty(+(num(row.qty)! - p.short).toFixed(3), unit)} in stock` : p?.source}
                        {p && p.cost > 0 && <span className="text-on-surface-variant"> · {usd(p.cost)}</span>}
                      </p>
                    </div>
                    <input aria-label="Amount used" type="number" inputMode="decimal" value={row.qty}
                      onChange={e => setParts(ps => ps.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))}
                      className="w-16 h-10 rounded-lg bg-surface border border-outline px-2 text-right tabular-nums type-body-lg outline-none focus:border-primary focus:border-2" />
                    <span className="type-body text-on-surface-variant w-8">{unit === 'each' ? '' : unit}</span>
                    <IconButton icon="close" label="Remove part" size="sm" onClick={() => setParts(ps => ps.filter((_, j) => j !== i))} />
                  </div>
                )
              })}
              <Button variant="tonal" icon="add" className="self-start" onClick={() => setPicker(true)}>Add part</Button>
            </section>

            {!isShop && (
              <div className="flex flex-col gap-1">
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="Shop would charge" prefix="$" type="number" inputMode="decimal" placeholder="optional" value={shopEquivalent} onChange={e => setShopEquivalent(e.target.value)} />
                  <ReadoutField label="Parts cost" value={parts.length ? usd(partsCost) : '—'} />
                </div>
                {saving$ != null && <p className={`type-body px-1 mt-1 ${saving$ >= 0 ? 'text-[var(--md-success)]' : 'text-on-surface-variant'}`}>{saving$ >= 0 ? `Saved ${usd(saving$)} doing it yourself.` : `${usd(-saving$)} more than a shop would charge.`}</p>}
              </div>
            )}
            {isShop && partsCost > 0 && chargedN != null && <p className="type-body text-on-surface-variant">Total {usd(chargedN + partsCost)}: {usd(chargedN)} to the shop and {usd(partsCost)} in your parts.</p>}

            {/* Receipts */}
            <section className="flex flex-col gap-2">
              <h3 className="type-title-sm text-on-surface-variant flex items-center gap-2"><Icon name="request_quote" size={18} />Receipts</h3>
              {(() => {
                const partReceipts = [...new Set(parts.flatMap(r => (planned.get(r.key)?.plan ?? []).filter(x => x.lot.lot.kind === 'receipt').map(x => x.lot.lot.sourceId)))]
                return partReceipts.length > 2 ? [...partReceipts.slice(0, 2), `more:${partReceipts.length - 2}`] : partReceipts
              })().map(rid => {
                if (rid.startsWith('more:')) return <p key={rid} className="type-body-sm text-on-surface-variant px-1">and {rid.slice(5)} more receipt{rid.slice(5) === '1' ? '' : 's'} for these parts</p>
                const r = ctx.receipts.get(rid)
                return r && (
                  <div key={rid} className="flex items-center gap-3 rounded-xl border border-outline-variant px-3 py-2">
                    <Avatar icon="receipt_long" tone="secondary" size={32} />
                    <span className="flex-1 min-w-0 type-body text-on-surface truncate">{r.store || 'Receipt'}{r.date ? ` · bought ${format(new Date(r.date + 'T00:00:00'), 'MMM d, yyyy')}` : ''}</span>
                    <span className="type-label text-on-surface-variant">For parts</span>
                  </div>
                )
              })}
              {bills.filter(b => !removedBills.includes(b.receiptId)).map(b => (
                <div key={b.receiptId} className="flex items-center gap-3 rounded-xl border border-outline-variant pl-3 pr-1 py-1.5">
                  <Avatar icon="request_quote" tone="tertiary" size={32} />
                  <span className="flex-1 min-w-0 type-body text-on-surface truncate">{b.label}</span>
                  <IconButton icon="close" size="sm" label="Remove this receipt" onClick={() => setRemovedBills(r => [...r, b.receiptId])} />
                </div>
              ))}
              {legacyReceipt && !dropLegacy && (
                <div className="flex items-center gap-3 rounded-xl border border-outline-variant pl-3 pr-1 py-1.5">
                  <Avatar icon="image" tone="tertiary" size={32} />
                  <span className="flex-1 min-w-0 type-body text-on-surface truncate">Receipt photo</span>
                  <IconButton icon="close" size="sm" label="Remove this receipt" onClick={() => setDropLegacy(true)} />
                </div>
              )}
              {uploads.map(u => (
                <div key={u.key} className="flex items-center gap-3 rounded-xl border border-outline-variant pl-3 pr-1 py-1.5">
                  <Avatar icon="attach_file" tone="tertiary" size={32} />
                  <span className="flex-1 min-w-0 type-body text-on-surface truncate">{u.file.name}</span>
                  <IconButton icon="close" size="sm" label="Remove" onClick={() => setUploads(us => us.filter(x => x.key !== u.key))} />
                </div>
              ))}
              <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f?.type.startsWith('image/')) setToCrop(f); else if (f) attach(f); e.target.value = '' }} />
              <Button variant="outlined" icon="add_a_photo" className="self-start" onClick={() => fileRef.current?.click()}>{isShop ? 'Add the shop’s bill' : 'Add a receipt'}</Button>
              <p className="type-body-sm text-on-surface-variant">Receipts for the parts above attach themselves, whenever you bought them. A photo added here belongs to this service.</p>
            </section>

            {tiresOn && (
              <TireFitting draft={tires} onChange={p => setTires(t => ({ ...t, ...p }))} lives={ctx.tireLives} products={ctx.tireProducts} />
            )}
            {cat?.tracks_tires && logId && <p className="type-body text-on-surface-variant">Tire positions from this service are edited in Stock → Tires.</p>}

            <TextArea label="Notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />

            {error && (
              <div role="alert" className="flex gap-3 items-start rounded-xl bg-error-container text-on-error-container p-3">
                <Icon name="error" size={20} fill />
                <p className="type-body min-w-0">{error}{!error.startsWith('Odometer') && ' Nothing you typed was lost; try Save again.'}</p>
              </div>
            )}

            {logId && (
              <Button variant="danger" icon="delete" className="self-start -ml-2" onClick={() => setConfirmDelete(true)}>Delete this service</Button>
            )}
          </div>
        )}
      </Dialog>

      {picker && ctx && (
        <PartPicker ctx={ctx} categoryId={catId} date={date} taken={parts}
          onClose={() => setPicker(false)}
          onPick={row => { addPart(row); setPicker(false) }} />
      )}
      {toCrop && <ImageCropModal file={toCrop} onConfirm={f => { attach(f); setToCrop(null) }} onCancel={() => setToCrop(null)} />}

      <Confirm open={confirmDelete} title="Delete this service?" confirmLabel="Delete" danger busy={saving}
        onCancel={() => setConfirmDelete(false)} onConfirm={remove}
        body={<>The {parts.length ? `${parts.length} part${parts.length === 1 ? '' : 's'} it used go back into stock` : 'service is removed'}{bills.length ? ', and its shop bill is deleted' : ''}. Product receipts are kept: they belong to the products.</>} />
    </>
  )
}

/* ── Add part: from stock, or from a receipt for something just bought ───── */
function PartPicker({ ctx, categoryId, date, taken, onClose, onPick }: {
  ctx: GarageContext
  categoryId: string
  date: string
  taken: PartRow[]
  onClose: () => void
  onPick: (row: Omit<PartRow, 'key'>) => void
}) {
  const [tab, setTab] = useState<'stock' | 'new'>('stock')
  const [query, setQuery] = useState('')
  const [fresh, setFresh] = useState<Fresh & { productId: string; used: string }>({ store: '', date, bought: '', price: '', newName: '', newUnit: 'qt', productId: '', used: '' })
  const takenQty = (pid: string) => taken.filter(t => t.productId === pid && !t.fresh).reduce((s, t) => s + (num(t.qty) ?? 0), 0)
  const inStock = [...ctx.stock.values()].map(s => ({ s, left: +(s.onHand - takenQty(s.product.id)).toFixed(3) })).filter(x => x.left > 0)
  const matches = (x: { s: { product: { name: string; brand: string | null } } }) => !query || productLabel(x.s.product).toLowerCase().includes(query.toLowerCase())
  const suggested = inStock.filter(x => categoryId && ctx.links.some(l => l.product_id === x.s.product.id && l.category_id === categoryId)).filter(matches)
  const rest = inStock.filter(x => !suggested.includes(x)).filter(matches)
  const freshProduct = ctx.products.find(p => p.id === fresh.productId)
  const freshUnit = freshProduct?.unit ?? fresh.newUnit
  const freshOk = (fresh.productId || fresh.newName.trim()) && num(fresh.bought) && num(fresh.price) != null && num(fresh.used || fresh.bought)

  const row = (x: (typeof inStock)[number]) => {
    const nextLot = x.s.lots.find(b => b.remaining > 0)
    return (
      <ListItem key={x.s.product.id} dense
        onClick={() => onPick({ productId: x.s.product.id, qty: x.s.unit === 'each' ? '1' : String(Math.min(x.left, 1)) })}
        leading={<Avatar icon="inventory_2" tone="secondary" size={36} />}
        headline={productLabel(x.s.product)}
        supporting={`${fmtQty(x.left, x.s.unit)} left${nextLot ? ` · ${lotSource(ctx, nextLot.lot.id)}` : ''}`}
        trailing={<Icon name="add" size={22} className="text-primary" />} />
    )
  }

  return (
    <Dialog open onClose={onClose} title="Add part" size="md"
      primary={tab === 'new' ? {
        label: 'Add', disabled: !freshOk,
        onClick: () => onPick({
          productId: fresh.productId, qty: fresh.used || fresh.bought,
          fresh: { store: fresh.store, date: fresh.date, bought: fresh.bought, price: fresh.price, newName: fresh.newName, newUnit: fresh.newUnit },
        }),
      } : undefined}>
      <div className="-mx-4 sm:-mx-6 -mt-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'stock', label: 'From stock', icon: 'inventory_2' }, { value: 'new', label: 'Just bought', icon: 'receipt_long' }]} />
      </div>
      {tab === 'stock' ? (
        <div className="pt-4">
          <TextField label="Search your stock" value={query} onChange={e => setQuery(e.target.value)} />
          <div className="-mx-4 sm:-mx-6 mt-2">
            {suggested.length > 0 && <p className="px-4 sm:px-6 pt-3 pb-1 type-title-sm text-primary">Used for this service</p>}
            {suggested.map(row)}
            {rest.length > 0 && <p className="px-4 sm:px-6 pt-3 pb-1 type-title-sm text-on-surface-variant">{suggested.length ? 'Everything else in stock' : 'In stock'}</p>}
            {rest.map(row)}
            {inStock.length === 0 && <p className="px-6 py-8 type-body text-on-surface-variant text-center">Nothing in stock. Use “Just bought” for parts you bought for this job.</p>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 pt-5">
          <p className="type-body text-on-surface-variant">For parts you bought for this job. The receipt is saved as a product receipt, its parts go into stock, and what you used comes straight back out for this service.</p>
          <SelectField label="Product" value={fresh.productId} onChange={e => setFresh(f => ({ ...f, productId: e.target.value }))}>
            <option value="">New product…</option>
            {pickable(ctx.products, fresh.productId).map(p => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
          </SelectField>
          {!fresh.productId && (
            <div className="grid grid-cols-[1fr_7rem] gap-3">
              <TextField label="Product name" value={fresh.newName} onChange={e => setFresh(f => ({ ...f, newName: e.target.value, newUnit: guessUnit(e.target.value) || f.newUnit }))} />
              <SelectField label="Counted in" value={fresh.newUnit} onChange={e => setFresh(f => ({ ...f, newUnit: e.target.value }))}>
                {UNIT_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.units.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>)}
              </SelectField>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Store" placeholder="e.g. AutoZone" value={fresh.store} onChange={e => setFresh(f => ({ ...f, store: e.target.value }))} />
            <TextField label="Bought on" type="date" value={fresh.date} onChange={e => setFresh(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <TextField label="Bought" suffix={freshUnit === 'each' ? '' : freshUnit} type="number" inputMode="decimal" value={fresh.bought} onChange={e => setFresh(f => ({ ...f, bought: e.target.value }))} />
            <TextField label="Paid" prefix="$" type="number" inputMode="decimal" value={fresh.price} onChange={e => setFresh(f => ({ ...f, price: e.target.value }))} />
            <TextField label="Used here" suffix={freshUnit === 'each' ? '' : freshUnit} type="number" inputMode="decimal" placeholder={fresh.bought || 'all'} value={fresh.used} onChange={e => setFresh(f => ({ ...f, used: e.target.value }))} />
          </div>
          {num(fresh.bought) != null && num(fresh.used || fresh.bought)! < num(fresh.bought)! && (
            <p className="type-body text-on-surface-variant">{fmtQty(+(num(fresh.bought)! - num(fresh.used || fresh.bought)!).toFixed(3), freshUnit)} stays in stock.</p>
          )}
        </div>
      )}
    </Dialog>
  )
}
