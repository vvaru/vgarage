'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { read, withRetry, write } from '@/lib/recover'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { convertProductUnit } from '@/lib/productUnit'
import { findType, type ProductType } from '@/lib/productTypes'
import { fmtQty, guessUnit, UNIT_GROUPS } from '@/lib/units'
import { loadGarage, type GarageContext } from '@/lib/formData'
import { Button, Chip, Confirm, Dialog, Icon, IconButton, Segmented, SelectField, Skeleton, TextArea, TextField } from '@/components/ui/md'
import type { ProductLink } from '@/lib/types'

interface LinkDraft { label: string; url: string }

// Add or edit a product: what it is, how stock is counted, what it's used for,
// and where to buy it again.
export default function ProductForm({ productId, onClose, onSaved }: { productId?: string; onClose: () => void; onSaved: (m: string) => void }) {
  const { user } = useAuth()
  const { vehicle } = useVehicle()
  const [ctx, setCtx] = useState<GarageContext | null>(null)
  const [types, setTypes] = useState<ProductType[]>([])
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [typeName, setTypeName] = useState('')
  const [directional, setDirectional] = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [unit, setUnit] = useState('')
  const [factor, setFactor] = useState('')
  const [notes, setNotes] = useState('')
  const [usedFor, setUsedFor] = useState<string[]>([])
  const [links, setLinks] = useState<LinkDraft[]>([{ label: 'Buy', url: '' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const newId = useRef(crypto.randomUUID())

  useEffect(() => {
    if (!user || !vehicle) return
    let live = true
    ;(async () => {
      const [g, t, l] = await Promise.all([
        loadGarage(user.id, vehicle.id, vehicle.odometer),
        read(supabase.from('product_types').select('*').eq('user_id', user.id).order('name')),
        productId ? read(supabase.from('product_links').select('*').eq('product_id', productId)) : Promise.resolve({ data: [] }),
      ])
      if (!live) return
      setCtx(g); setTypes((t.data ?? []) as ProductType[])
      const p = g.products.find(x => x.id === productId)
      if (p) {
        setName(p.name); setBrand(p.brand ?? ''); setNotes(p.notes ?? ''); setUnit(p.unit ?? 'each')
        setTypeName(((t.data ?? []) as ProductType[]).find(x => x.id === p.product_type_id)?.name ?? '')
        setDirectional(p.tire_directional === true ? 'yes' : p.tire_directional === false ? 'no' : 'unknown')
        setUsedFor(g.links.filter(x => x.product_id === p.id).map(x => x.category_id))
        const ls = (l.data ?? []) as ProductLink[]
        if (ls.length) setLinks(ls.map(x => ({ label: x.label, url: x.url })))
      }
    })().catch(e => { if (live) setError(e instanceof Error ? e.message : 'Couldn’t load the product.') })
    return () => { live = false }
  }, [user, vehicle, productId])

  const original = ctx?.products.find(x => x.id === productId)
  const stock = productId ? ctx?.stock.get(productId) : undefined
  const effUnit = unit || guessUnit(name)
  const unitChanged = Boolean(original && (original.unit ?? 'each') !== effUnit)
  const isTire = /\b(tires?|tyres?)\b/i.test(typeName) || /\b(tires?|tyres?)\b/i.test(name)
  const hasHistory = Boolean(stock && (stock.lots.length > 0 || stock.allocations.length > 0))
  const valid = name.trim() && (!unitChanged || parseFloat(factor) > 0)
  const categories = useMemo(() => (ctx?.categories ?? []).filter(c => c.is_visible !== false), [ctx])

  async function save() {
    if (!user || !ctx) return
    setSaving(true); setError(null)
    try {
      await ensureFreshSession()
      const w = async (q: PromiseLike<{ error: { message: string } | null }>, what: string) => {
        const { error: e } = await withRetry(() => write(q), 2, 2500); if (e) throw new Error(`${what}: ${e.message}`)
      }
      if (unitChanged && original) await convertProductUnit(original.id, original.unit ?? 'each', effUnit, parseFloat(factor))
      let typeId: string | null = null
      if (typeName.trim()) {
        const existing = findType(types, typeName)
        if (existing) typeId = existing.id
        else {
          const { data, error: e } = await withRetry(() => write(supabase.from('product_types').insert({ user_id: user.id, name: typeName.trim() }).select('id').single()), 1, 2500)
          if (e) throw new Error(`Adding the type: ${e.message}`)
          typeId = (data as { id: string } | null)?.id ?? null
        }
      }
      const id = productId ?? newId.current
      const payload = {
        user_id: user.id, vehicle_id: null, name: name.trim(), brand: brand.trim() || null, unit: effUnit,
        product_type_id: typeId, notes: notes.trim() || null,
        tire_directional: isTire && directional !== 'unknown' ? directional === 'yes' : null,
      }
      if (productId) await w(supabase.from('products').update(payload).eq('id', id), 'Saving the product')
      else await w(supabase.from('products').upsert({ id, ...payload }), 'Saving the product')
      await w(supabase.from('product_links').delete().eq('product_id', id), 'Saving links')
      const good = links.filter(l => l.url.trim())
      if (good.length) await w(supabase.from('product_links').insert(good.map(l => ({ product_id: id, label: l.label.trim() || 'Buy', url: l.url.trim() }))), 'Saving links')
      await w(supabase.from('product_category_links').delete().eq('product_id', id), 'Saving what it’s used for')
      if (usedFor.length) await w(supabase.from('product_category_links').insert(usedFor.map(c => ({ product_id: id, category_id: c }))), 'Saving what it’s used for')
      onSaved(productId ? 'Product updated' : `${name.trim()} added`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!productId || hasHistory) return
    setSaving(true)
    const { error: e } = await withRetry(() => write(supabase.from('products').delete().eq('id', productId)), 1, 2500)
    setSaving(false)
    if (e) { setError(e.message); setConfirmDelete(false); return }
    onSaved('Product deleted')
  }

  return (
    <>
      <Dialog open onClose={onClose} title={productId ? 'Edit product' : 'Add product'} size="md"
        primary={{ label: 'Save', onClick: save, disabled: !valid || saving, loading: saving }}>
        {!ctx ? <div className="space-y-4">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div> : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextField label="Name" placeholder="e.g. Ultra Platinum 0W-20" value={name} onChange={e => { setName(e.target.value); if (!productId && !unit) setUnit('') }} />
              <TextField label="Brand" placeholder="optional" value={brand} onChange={e => setBrand(e.target.value)} />
            </div>
            <TextField label="What it is" placeholder="e.g. Motor oil, Tires, Oil filter" list="product-types" value={typeName} onChange={e => setTypeName(e.target.value)}
              helper="Groups similar products together." />
            <datalist id="product-types">{types.map(t => <option key={t.id} value={t.name} />)}</datalist>
            {isTire && (
              <div className="flex flex-col gap-2">
                <span className="type-body text-on-surface-variant">Directional tread?</span>
                <Segmented value={directional} onChange={setDirectional} label="Directional tread"
                  options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Not sure' }]} />
                <span className="type-body-sm text-on-surface-variant">Directional tires only rotate front↔back on the same side; rotation suggestions follow this.</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="Counted in" value={effUnit} onChange={e => setUnit(e.target.value)}>
                {UNIT_GROUPS.map(g => <optgroup key={g.label} label={g.label}>{g.units.map(u => <option key={u} value={u}>{u === 'each' ? 'each (a count)' : u}</option>)}</optgroup>)}
              </SelectField>
              {unitChanged ? (
                <TextField label={`1 ${original?.unit ?? 'each'} =`} suffix={effUnit} type="number" inputMode="decimal" value={factor} onChange={e => setFactor(e.target.value)}
                  error={!(parseFloat(factor) > 0) ? 'Needed to convert stock' : undefined} />
              ) : (
                <span className="flex items-center type-body text-on-surface-variant px-1">Stock reads “{fmtQty(3, effUnit)} left”.</span>
              )}
            </div>
            {unitChanged && stock && parseFloat(factor) > 0 && (
              <p className="type-body text-on-surface-variant -mt-2">Everything logged converts: your {fmtQty(stock.onHand, original?.unit)} on hand becomes {fmtQty(+(stock.onHand * parseFloat(factor)).toFixed(4), effUnit)}.</p>
            )}

            <div className="flex flex-col gap-2">
              <span className="type-title-sm text-on-surface-variant flex items-center gap-2"><Icon name="build" size={18} />Used for</span>
              <div className="flex flex-wrap gap-2">
                {categories.map(c => (
                  <Chip key={c.id} selected={usedFor.includes(c.id)} onClick={() => setUsedFor(u => u.includes(c.id) ? u.filter(x => x !== c.id) : [...u, c.id])}>{c.name}</Chip>
                ))}
              </div>
              <span className="type-body-sm text-on-surface-variant">Logging one of these services suggests this product first.</span>
            </div>

            <div className="flex flex-col gap-3">
              <span className="type-title-sm text-on-surface-variant flex items-center gap-2"><Icon name="link" size={18} />Where to buy it</span>
              {links.map((l, i) => (
                <div key={i} className="grid grid-cols-[6.5rem_1fr_auto] gap-2 items-start">
                  <TextField label="Label" value={l.label} onChange={e => setLinks(ls => ls.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                  <TextField label="Link" type="url" placeholder="https://" value={l.url} onChange={e => setLinks(ls => ls.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
                  <IconButton icon="close" label="Remove link" className="mt-2" onClick={() => setLinks(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ label: 'Buy', url: '' }])} />
                </div>
              ))}
              <Button variant="text" icon="add" className="self-start -ml-2" onClick={() => setLinks(ls => [...ls, { label: 'Buy', url: '' }])}>Add another link</Button>
            </div>

            <TextArea label="Notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            {error && <p role="alert" className="type-body text-error">{error}</p>}
            {productId && (
              hasHistory
                ? <p className="type-body-sm text-on-surface-variant flex gap-2"><Icon name="lock" size={16} className="mt-px" />Can’t be deleted: it has purchases or use on record, and deleting would erase them from your history.</p>
                : <Button variant="danger" icon="delete" className="self-start -ml-2" onClick={() => setConfirmDelete(true)}>Delete product</Button>
            )}
          </div>
        )}
      </Dialog>
      <Confirm open={confirmDelete} title="Delete this product?" confirmLabel="Delete" danger busy={saving}
        onCancel={() => setConfirmDelete(false)} onConfirm={remove} body="It has no purchases or use on record, so nothing else changes." />
    </>
  )
}
