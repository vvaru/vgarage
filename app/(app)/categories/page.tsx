'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { read, runSave, step } from '@/lib/recover'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { useDataRefresh, useForms } from '@/components/shell/forms'
import PageHeader, { Page } from '@/components/shell/PageHeader'
import { addFromCatalog, intervalOffers, intervalText, mergeCategory, missingFromCatalog } from '@/lib/categories'
import { ZONES, zoneById, zoneFor, type ZoneId } from '@/lib/carZones'
import { guessUnit } from '@/lib/units'
import {
  Avatar, Button, Card, Confirm, Dialog, EmptyState, IconButton, ListItem, Pill, Segmented, SelectField, Skeleton, TextArea, TextField, useSnackbar,
} from '@/components/ui/md'
import type { CategoryRequest, GlobalCategory, Product, ProductCategoryLink, ServiceCategory, ServiceCategoryProduct } from '@/lib/types'

interface Data {
  cats: ServiceCategory[]
  catalog: GlobalCategory[]
  links: ProductCategoryLink[]
  products: Product[]
  oldProducts: ServiceCategoryProduct[]
  requests: CategoryRequest[]
}

// An interval change you said no to stays quiet until the catalog changes again.
const KEPT_KEY = 'vgarage_catalog_kept'
const keptId = (catId: string, g: GlobalCategory) => `${catId}:${g.interval_miles}:${g.interval_days}`
function loadKept(): string[] {
  try { return JSON.parse(localStorage.getItem(KEPT_KEY) ?? '[]') as string[] } catch { return [] }
}

const int = (s: string) => (s.trim() ? parseInt(s) : null)

export default function CategoriesPage() {
  const { user } = useAuth()
  const { vehicle } = useVehicle()
  const { changed } = useForms()
  const snack = useSnackbar()
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  useDataRefresh(reload)

  const [kept, setKept] = useState<string[]>(loadKept)
  const [editing, setEditing] = useState<ServiceCategory | 'new' | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vid = vehicle?.id
  const uid = user?.id

  useEffect(() => {
    if (!vid || !uid) return
    let live = true
    Promise.all([
      read(supabase.from('service_categories').select('*').eq('vehicle_id', vid).order('name')),
      read(supabase.from('global_categories').select('*').order('name')),
      read(supabase.from('product_category_links').select('*')),
      read(supabase.from('products').select('*').eq('user_id', uid).order('name')),
      read(supabase.from('service_category_products').select('*').eq('vehicle_id', vid)),
      read(supabase.from('category_requests').select('*').eq('user_id', uid).order('created_at', { ascending: false })),
    ]).then(([cats, catalog, links, products, oldProducts, requests]) => {
      if (!live) return
      if (cats.error) throw new Error(cats.error.message)
      setData({
        cats: ((cats.data ?? []) as ServiceCategory[]).sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })),
        catalog: (catalog.data ?? []) as GlobalCategory[],
        links: (links.data ?? []) as ProductCategoryLink[],
        products: (products.data ?? []) as Product[],
        oldProducts: (oldProducts.data ?? []) as ServiceCategoryProduct[],
        requests: (requests.data ?? []) as CategoryRequest[],
      })
      setLoadError(null)
    }).catch(e => { if (live) setLoadError(e instanceof Error ? e.message : 'Couldn’t load your categories.') })
    return () => { live = false }
  }, [vid, uid, tick])

  const missing = useMemo(() => (data ? missingFromCatalog(data.catalog, data.cats) : []), [data])
  const offers = useMemo(() => (data ? intervalOffers(data.catalog, data.cats).filter(o => !kept.includes(keptId(o.cat.id, o.entry))) : []), [data, kept])
  const duplicates = useMemo(() => {
    const byName = new Map<string, ServiceCategory[]>()
    for (const c of data?.cats ?? []) {
      const k = c.name.trim().toLowerCase()
      byName.set(k, [...(byName.get(k) ?? []), c])
    }
    return [...byName.values()].filter(g => g.length > 1)
  }, [data])
  const duplicateIds = new Set(duplicates.flatMap(g => g.map(c => c.id)))

  async function act(work: () => Promise<void>, done: string) {
    setBusy(true); setError(null)
    const res = await runSave(work)
    setBusy(false)
    if (!res.ok) { setError(res.message); return false }
    snack(done)
    changed()
    return true
  }

  if (!vehicle || !user) return null

  const addMissing = () => act(() => addFromCatalog(missing, user.id, vehicle.id), `Added ${missing.length} ${missing.length === 1 ? 'category' : 'categories'}`)
  const applyCatalogInterval = (cat: ServiceCategory, g: GlobalCategory) => act(
    () => step(() => supabase.from('service_categories').update({ interval_miles: g.interval_miles, interval_days: g.interval_days }).eq('id', cat.id)).then(() => {}),
    `${cat.name} updated`,
  )
  function keepMine(cat: ServiceCategory, g: GlobalCategory) {
    const next = [...kept, keptId(cat.id, g)]
    setKept(next)
    try { localStorage.setItem(KEPT_KEY, JSON.stringify(next)) } catch { /* only forgets the choice on this device */ }
  }
  const mergeDuplicates = () => act(async () => {
    for (const group of duplicates) {
      const primary = group.find(c => c.interval_miles || c.interval_days) ?? group[0]
      for (const dup of group) if (dup.id !== primary.id) await mergeCategory(dup, primary)
    }
  }, 'Duplicates merged')

  const groups: { title: string; rows: ServiceCategory[] }[] = data ? [
    { title: 'Service', rows: data.cats.filter(c => c.category_type === 'maintenance' && c.sub_type !== 'check') },
    { title: 'Checks', rows: data.cats.filter(c => c.category_type === 'maintenance' && c.sub_type === 'check') },
    { title: 'Repairs', rows: data.cats.filter(c => c.category_type === 'repair') },
  ].filter(g => g.rows.length > 0) : []

  const row = (c: ServiceCategory) => {
    const count = data!.links.filter(l => l.category_id === c.id).length
    const supporting = [
      intervalText(c) ?? (c.category_type === 'repair' ? 'As needed' : 'No reminder'),
      count ? `${count} product${count === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ')
    return (
      <ListItem key={c.id} onClick={() => setEditing(c)} headline={c.name} supporting={supporting}
        leading={<Avatar icon={c.tracks_tires ? 'tire_repair' : c.category_type === 'repair' ? 'car_repair' : c.sub_type === 'check' ? 'check_circle' : 'build'} tone="secondary" />}
        trailing={duplicateIds.has(c.id)
          ? <Pill tone="due">Duplicate</Pill>
          : c.is_visible === false ? <Pill>Hidden</Pill>
          : <span className="max-sm:hidden"><Pill tone={c.global_category_id ? 'neutral' : 'info'}>{c.global_category_id ? 'Catalog' : 'Yours'}</Pill></span>} />
    )
  }

  return (
    <Page>
      <PageHeader title="Service categories" subtitle="What you track on this car and how often"
        actions={<>
          <Button variant="tonal" icon="lightbulb" className="max-sm:hidden" onClick={() => setSuggesting(true)}>Suggest</Button>
          <Button icon="add" className="max-sm:hidden ml-2" onClick={() => setEditing('new')}>New category</Button>
          <IconButton icon="add" label="New category" className="sm:hidden" onClick={() => setEditing('new')} />
        </>} />

      {error && <p role="alert" className="type-body text-error mb-4">{error}</p>}

      {!data ? (
        loadError
          ? <EmptyState icon="cloud_off" title="Couldn’t load your categories" body={loadError} action={<Button onClick={reload}>Try again</Button>} />
          : <div className="grid gap-3 max-w-3xl">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-[72px]" />)}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
          <div className="flex flex-col gap-4 min-w-0">
            {duplicates.length > 0 && (
              <Card variant="plain" className="p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-52">
                  <p className="type-title-sm text-on-surface">{duplicates.length} duplicate {duplicates.length === 1 ? 'category' : 'categories'}</p>
                  <p className="type-body text-on-surface-variant">{duplicates.map(g => g[0].name).join(', ')}. Merging keeps the one with a schedule and moves all history to it.</p>
                </div>
                <Button variant="tonal" onClick={mergeDuplicates} loading={busy}>Merge</Button>
              </Card>
            )}
            {groups.length === 0 && (
              <Card variant="outlined">
                <EmptyState icon="category" title="No categories on this car"
                  body={missing.length ? 'Add the ones from the catalog to start getting reminders, or make your own.' : 'Make one to start getting reminders.'}
                  action={missing.length ? <Button icon="add" onClick={addMissing} loading={busy}>Add {missing.length} from the catalog</Button> : <Button icon="add" onClick={() => setEditing('new')}>New category</Button>} />
              </Card>
            )}
            {groups.map(g => (
              <section key={g.title} className="flex flex-col gap-2">
                <h2 className="type-title-sm text-on-surface-variant px-1">{g.title}</h2>
                <Card variant="outlined" className="py-1 overflow-hidden">{g.rows.map(row)}</Card>
              </section>
            ))}
            <Button variant="tonal" icon="lightbulb" className="sm:hidden self-start" onClick={() => setSuggesting(true)}>Suggest for the catalog</Button>
          </div>

          <aside className="flex flex-col gap-4 min-w-0 max-lg:-order-1 empty:hidden">
            {missing.length > 0 && groups.length > 0 && (
              <Card variant="plain" className="p-4 flex flex-col gap-3 !bg-primary-container text-on-primary-container">
                <div>
                  <p className="type-title-sm">{missing.length} new in the catalog</p>
                  <p className="type-body">{missing.map(m => m.name).join(', ')}</p>
                </div>
                <Button className="self-start" icon="add" onClick={addMissing} loading={busy}>Add {missing.length === 1 ? 'it' : 'them'}</Button>
              </Card>
            )}
            {offers.length > 0 && (
              <Card variant="plain" className="p-4 flex flex-col gap-4">
                <p className="type-title-sm text-on-surface">The catalog changed</p>
                {offers.map(({ cat, entry }) => (
                  <div key={cat.id} className="flex flex-col gap-2">
                    <p className="type-body text-on-surface-variant">
                      <span className="text-on-surface">{cat.name}</span>: {intervalText(entry) ?? 'no reminder'}. Yours: {(intervalText(cat) ?? 'no reminder').replace(/^E/, 'e')}.
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="tonal" disabled={busy} onClick={() => applyCatalogInterval(cat, entry)}>Use the catalog’s</Button>
                      <Button size="sm" variant="text" onClick={() => keepMine(cat, entry)}>Keep mine</Button>
                    </div>
                  </div>
                ))}
              </Card>
            )}
            {data.requests.length > 0 && (
              <Card variant="plain" className="p-4 flex flex-col gap-3">
                <p className="type-title-sm text-on-surface">Your suggestions</p>
                {data.requests.map(r => (
                  <div key={r.id} className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="type-body text-on-surface truncate">{r.name}</p>
                      <p className="type-body-sm text-on-surface-variant">{format(parseISO(r.created_at), 'MMM d, yyyy')}{r.admin_notes ? ` · ${r.admin_notes}` : ''}</p>
                    </div>
                    <Pill tone={r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'due' : 'soon'}>{r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Approved' : 'Declined'}</Pill>
                  </div>
                ))}
              </Card>
            )}
          </aside>
        </div>
      )}

      {editing && data && (
        <CategoryDialog key={editing === 'new' ? 'new' : editing.id} category={editing === 'new' ? null : editing} data={data} userId={user.id} vehicleId={vehicle.id}
          onClose={() => setEditing(null)}
          onSaved={m => { setEditing(null); snack(m); changed() }}
          onProductMade={() => { changed(); snack('Now a real product in Stock') }} />
      )}
      {suggesting && (
        <SuggestDialog userId={user.id} vehicleId={vehicle.id} onClose={() => setSuggesting(false)}
          onSaved={() => { setSuggesting(false); snack('Suggestion sent'); reload() }} />
      )}
    </Page>
  )
}

function CategoryDialog({ category, data, userId, vehicleId, onClose, onSaved, onProductMade }: {
  category: ServiceCategory | null
  data: Data
  userId: string
  vehicleId: string
  onClose: () => void
  onSaved: (message: string) => void
  onProductMade: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [type, setType] = useState<'maintenance' | 'repair'>(category?.category_type ?? 'maintenance')
  const [subType, setSubType] = useState<'service' | 'check'>(category?.sub_type ?? 'service')
  const [miles, setMiles] = useState(category?.interval_miles != null ? String(category.interval_miles) : '')
  const [days, setDays] = useState(category?.interval_days != null ? String(category.interval_days) : '')
  const [zone, setZone] = useState(category?.component ?? '')
  const [tires, setTires] = useState(Boolean(category?.tracks_tires))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const shownZone = (zone || zoneFor(name) || 'general') as ZoneId
  const renamed = Boolean(category && name.trim() && name.trim() !== category.name)
  const used = category ? data.products.filter(p => data.links.some(l => l.category_id === category.id && l.product_id === p.id)) : []
  const oldList = category ? data.oldProducts.filter(p => p.category_id === category.id) : []

  async function save() {
    setSaving(true); setError(null)
    const fields = {
      name: name.trim(),
      sub_type: type === 'maintenance' ? subType : null,
      interval_miles: int(miles),
      interval_days: int(days),
      tracks_tires: tires,
      component: zone || zoneFor(name) || 'general',
    }
    const res = await runSave(async () => {
      if (category) {
        await step(() => supabase.from('service_categories').update(fields).eq('id', category.id))
        if (renamed) await step(() => supabase.from('service_logs').update({ service_type: fields.name }).eq('category_id', category.id))
      } else {
        await step(() => supabase.from('service_categories').insert({ ...fields, user_id: userId, vehicle_id: vehicleId, category_type: type, is_visible: true }))
      }
    })
    setSaving(false)
    if (!res.ok) { setError(res.message); return }
    onSaved(category ? 'Category updated' : `${fields.name} added`)
  }

  async function remove() {
    if (!category) return
    setSaving(true)
    const res = await runSave(() => step(() => supabase.from('service_categories').delete().eq('id', category.id)).then(() => {}))
    setSaving(false)
    setConfirmDelete(false)
    if (!res.ok) { setError(res.message); return }
    onSaved('Category deleted')
  }

  // The old free-text product lists become real products, one tap each.
  async function makeProduct(old: ServiceCategoryProduct) {
    if (!category) return
    setSaving(true); setError(null)
    const res = await runSave(async () => {
      const existing = data.products.find(p => p.name.trim().toLowerCase() === old.name.trim().toLowerCase())
      const productId = existing?.id ?? crypto.randomUUID()
      if (!existing) {
        await step(() => supabase.from('products').upsert({
          id: productId, user_id: userId, vehicle_id: null, name: old.name.trim(), brand: null, unit: guessUnit(old.name),
          notes: old.last_price != null ? `Last price $${Number(old.last_price).toFixed(2)}` : null,
        }))
        if (old.product_url) await step(() => supabase.from('product_links').insert({ product_id: productId, label: 'Buy', url: old.product_url }))
      }
      if (!data.links.some(l => l.category_id === category.id && l.product_id === productId)) {
        await step(() => supabase.from('product_category_links').insert({ product_id: productId, category_id: category.id }))
      }
      await step(() => supabase.from('service_category_products').delete().eq('id', old.id))
    })
    setSaving(false)
    if (!res.ok) { setError(res.message); return }
    onProductMade()
  }

  return (
    <>
      <Dialog open onClose={onClose} title={category ? 'Edit category' : 'New category'} size="md"
        subtitle={category ? undefined : 'Only on this car. To offer it to everyone, suggest it for the catalog.'}
        primary={{ label: 'Save', onClick: save, disabled: !name.trim() || saving, loading: saving }}>
        <div className="flex flex-col gap-5">
          {!category && (
            <Segmented className="w-full" value={type} onChange={setType} label="Kind of category"
              options={[{ value: 'maintenance', label: 'Maintenance', icon: 'build' }, { value: 'repair', label: 'Repair', icon: 'car_repair' }]} />
          )}
          <TextField label="Name" placeholder={type === 'repair' ? 'e.g. Strut replacement' : 'e.g. Coolant flush'} value={name} onChange={e => setName(e.target.value)}
            helper={renamed ? 'Renaming also updates your past records.' : undefined} />
          {type === 'maintenance' && (
            <Segmented className="w-full" value={subType} onChange={setSubType} label="Service or check"
              options={[{ value: 'service', label: 'Service' }, { value: 'check', label: 'Check' }]} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextField label="Every" suffix="mi" type="number" inputMode="numeric" value={miles} onChange={e => setMiles(e.target.value)} />
            <TextField label="or every" suffix="days" type="number" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />
          </div>
          <SelectField label="Part of the car" value={shownZone} onChange={e => setZone(e.target.value)}
            helper={`${zoneById(shownZone).hint}${!zone && name.trim() ? ' · suggested from the name' : ''}`}>
            {ZONES.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
          </SelectField>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={tires} onChange={e => setTires(e.target.checked)} className="mt-1 w-[18px] h-[18px] accent-[var(--md-primary)]" />
            <span>
              <span className="block type-body-lg text-on-surface">This one replaces tires</span>
              <span className="block type-body text-on-surface-variant">Logging it asks which corners were fitted, so tire life can be tracked.</span>
            </span>
          </label>
          {category && (
            <div className="flex flex-col gap-1">
              <p className="type-title-sm text-on-surface-variant">Products used for this</p>
              <p className="type-body text-on-surface-variant">
                {used.length ? used.map(p => p.name).join(', ') : 'None yet.'} Set this on a product under “Used for”.
              </p>
            </div>
          )}
          {oldList.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="type-title-sm text-on-surface-variant">From your old product list</p>
              {oldList.map(p => (
                <div key={p.id} className="flex items-center gap-3">
                  <span className="flex-1 min-w-0 type-body text-on-surface truncate">{p.name}{p.last_price != null ? ` · $${Number(p.last_price).toFixed(2)}` : ''}</span>
                  <Button size="sm" variant="tonal" disabled={saving} onClick={() => makeProduct(p)}>Make it a product</Button>
                </div>
              ))}
            </div>
          )}
          {error && <p role="alert" className="type-body text-error">{error}</p>}
          {category && <Button variant="danger" icon="delete" className="self-start -ml-2" onClick={() => setConfirmDelete(true)}>Delete this category</Button>}
        </div>
      </Dialog>
      <Confirm open={confirmDelete} title="Delete this category?" confirmLabel="Delete" danger busy={saving}
        onCancel={() => setConfirmDelete(false)} onConfirm={remove}
        body="Your service records stay, but they lose their link to this category and stop counting toward its reminder." />
    </>
  )
}

function SuggestDialog({ userId, vehicleId, onClose, onSaved }: { userId: string; vehicleId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [miles, setMiles] = useState('')
  const [days, setDays] = useState('')
  const [why, setWhy] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setSaving(true); setError(null)
    const res = await runSave(() => step(() => supabase.from('category_requests').insert({
      user_id: userId, vehicle_id: vehicleId, status: 'pending', name: name.trim(), description: why.trim() || null, interval_miles: int(miles), interval_days: int(days),
    })).then(() => {}))
    setSaving(false)
    if (!res.ok) { setError(res.message); return }
    onSaved()
  }

  return (
    <Dialog open onClose={onClose} title="Suggest a category" subtitle="The admin can add it to the catalog and offer it to everyone." size="md"
      primary={{ label: 'Send', onClick: send, disabled: !name.trim() || saving, loading: saving }}>
      <div className="flex flex-col gap-5">
        <TextField label="Name" placeholder="e.g. Timing belt" value={name} onChange={e => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Every" suffix="mi" type="number" inputMode="numeric" value={miles} onChange={e => setMiles(e.target.value)} />
          <TextField label="or every" suffix="days" type="number" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />
        </div>
        <TextArea label="Why (optional)" rows={2} value={why} onChange={e => setWhy(e.target.value)} />
        {error && <p role="alert" className="type-body text-error">{error}</p>}
      </div>
    </Dialog>
  )
}
