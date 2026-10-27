'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO, subMonths } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { runSave, step } from '@/lib/recover'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { useForms } from '@/components/shell/forms'
import PageHeader, { Page } from '@/components/shell/PageHeader'
import { useStockData, type StockData } from '@/lib/useStockData'
import { useIsDesktop } from '@/lib/useMedia'
import { fmtQty } from '@/lib/units'
import { receiptTitle } from '@/lib/receipts'
import type { ProductStock } from '@/lib/inventory'
import TirePanel from '@/components/tires/TirePanel'
import RotateTiresModal from '@/components/tires/RotateTiresModal'
import { type IconName } from '@/components/ui/Icon'
import {
  Avatar, Button, Card, Chip, Dialog, EmptyState, Icon, IconButton, ListItem, Metric, Pill, Skeleton, Tabs, TextField,
} from '@/components/ui/md'
import type { Product } from '@/lib/types'

type Tab = 'stock' | 'products' | 'receipts' | 'tires'
type ProductU = Product & { unit?: string }

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (d: string | null, f = 'MMM d, yyyy') => (d ? format(parseISO(d), f) : 'Undated')

// A product's icon follows what it is.
function iconFor(label: string): IconName {
  if (/tire|tyre/i.test(label)) return 'tire_repair'
  if (/oil|fluid|coolant|antifreeze|\b\d+W-?\d+\b/i.test(label)) return 'oil_barrel'
  if (/washer|water/i.test(label)) return 'water_drop'
  if (/filter|air/i.test(label)) return 'air'
  return 'build'
}

export default function StockPage() {
  const { user } = useAuth()
  const { vehicle, refresh: refreshVehicle } = useVehicle()
  const { open } = useForms()
  const router = useRouter()
  const desktop = useIsDesktop()
  const { data, error, reload } = useStockData(user?.id, vehicle?.id, vehicle?.odometer ?? 0)
  const [tab, setTab] = useState<Tab>('stock')
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [rotate, setRotate] = useState(false)

  // Deep link from the Services health map: /products?tires=1
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tires') !== '1') return
    const t = setTimeout(() => setTab('tires'), 0)
    router.replace('/products')
    return () => clearTimeout(t)
  }, [router])

  const v = useMemo(() => (data ? view(data) : null), [data])

  if (!vehicle) return null
  const g = data?.garage

  const header = (
    <PageHeader title="Stock" showVehicle={false}
      subtitle={v ? `${v.inStock.length} on hand · ${usd(v.value)} worth` : 'Parts and fluids you keep'}
      actions={<>
        <Button variant="tonal" icon="add_box" className="max-sm:hidden" onClick={() => open({ kind: 'product' })}>New product</Button>
        <Button icon="receipt_long" className="max-sm:hidden ml-2" onClick={() => open({ kind: 'receipt' })}>Add receipt</Button>
        <IconButton icon="add_box" label="New product" className="sm:hidden" onClick={() => open({ kind: 'product' })} />
      </>} />
  )

  if (!data || !v || !g) {
    return (
      <Page>
        {header}
        {error
          ? <EmptyState icon="cloud_off" title="Couldn’t load your stock" body={error} action={<Button onClick={reload}>Try again</Button>} />
          : <div className="grid gap-4"><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-96" /></div>}
      </Page>
    )
  }

  const typeName = (p: ProductU) => data.types.find(t => t.id === p.product_type_id)?.name
  const titleOf = (p: ProductU) => typeName(p) ?? p.name
  const subOf = (p: ProductU) => (typeName(p) ? [p.name, p.brand].filter(Boolean).join(' · ') : p.brand ?? '')
  const hasTires = g.tireLives.some(l => !l.retired) || g.categories.some(c => c.tracks_tires)
  const sel = selected ? g.stock.get(selected) ?? null : null

  const productRow = (s: ProductStock) => {
    const p = s.product as ProductU
    const empty = s.onHand <= 0
    return (
      <ListItem key={p.id} onClick={() => setSelected(p.id)} selected={desktop && selected === p.id}
        leading={<Avatar icon={g.tireProducts.some(t => t.id === p.id) ? 'tire_repair' : iconFor(`${typeName(p) ?? ''} ${p.name}`)} tone={empty ? 'neutral' : 'primary'} />}
        headline={titleOf(p)} supporting={subOf(p) || (s.purchased ? `${fmtQty(s.purchased, s.unit)} bought` : 'Never bought')}
        trailing={empty
          ? <span className="type-body text-on-surface-variant">{s.purchased || s.consumed ? 'None left' : '—'}</span>
          : <span className="text-on-surface">{fmtQty(+s.onHand.toFixed(3), s.unit)}</span>} />
    )
  }

  const list = (rows: ProductStock[], empty: ReactNode) => (
    <Card variant="outlined" className="py-1 overflow-hidden">{rows.length ? rows.map(productRow) : empty}</Card>
  )

  const filtered = v.all.filter(s => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    const p = s.product as ProductU
    return [p.name, p.brand, typeName(p)].some(x => x?.toLowerCase().includes(q))
  })

  return (
    <Page>
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Metric icon="inventory_2" label="On hand" value={v.inStock.length} unit={v.inStock.length === 1 ? 'product' : 'products'} sub={`${v.all.length} in your catalog`} />
        <Metric icon="savings" label="Worth" value={usd(v.value)} sub="what’s left, at what you paid" />
        <Metric icon="shopping_cart" label="Bought, last 12 months" value={usd(v.spent12)} sub={`${v.receipts12} receipt${v.receipts12 === 1 ? '' : 's'}`} />
        <Metric icon="build" label="Used, last 12 months" value={usd(v.used12)} sub="parts that went into services" />
      </div>

      <Tabs className="-mx-4 sm:mx-0 mb-5" value={tab} onChange={t => { setTab(t); setSelected(null) }}
        tabs={[
          { value: 'stock', label: 'In stock', icon: 'inventory_2' },
          { value: 'products', label: 'All products', icon: 'category' },
          { value: 'receipts', label: 'Receipts', icon: 'receipt_long' },
          ...(hasTires ? [{ value: 'tires' as const, label: 'Tires', icon: 'tire_repair' as const }] : []),
        ]} />

      {tab === 'tires' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          <Card variant="outlined" className="p-4 sm:p-6">
            <TirePanel lives={g.tireLives} currentOdometer={vehicle.odometer}
              productName={id => { const p = g.products.find(x => x.id === id); return p ? [p.brand, p.name].filter(Boolean).join(' ') : 'Tire' }}
              trackPositions={vehicle.track_tire_positions !== false}
              onRotate={() => setRotate(true)}
              onResumeTracking={async () => {
                await runSave(() => step(() => supabase.from('vehicles').update({ track_tire_positions: true }).eq('id', vehicle.id)).then(() => {}))
                await refreshVehicle()
              }} />
          </Card>
          <Card variant="filled" className="p-5 flex flex-col gap-3">
            <p className="type-title text-on-surface">Tire jobs</p>
            <p className="type-body text-on-surface-variant">New tires are logged as a service; the fitting step records which tire went where.</p>
            <Button icon="rotate_right" variant="tonal" onClick={() => setRotate(true)} disabled={!g.tireLives.some(l => l.mounted)}>Rotate tires</Button>
            <Button icon="add" variant="outlined" onClick={() => {
              const cat = g.categories.find(c => c.tracks_tires)
              open({ kind: 'service', categoryId: cat?.id })
            }}>Log new tires</Button>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-6 items-start">
          <div className="flex flex-col gap-3 min-w-0">
            {tab === 'stock' && list(v.inStock, (
              <EmptyState icon="inventory_2" title="Nothing on the shelf" body="Add a receipt for parts or fluids you bought, or add stock you already have."
                action={<div className="flex gap-2 flex-wrap justify-center">
                  <Button icon="receipt_long" onClick={() => open({ kind: 'receipt' })}>Add receipt</Button>
                  <Button variant="tonal" icon="add" onClick={() => open({ kind: 'stock', mode: 'add' })}>Add stock</Button>
                </div>} />
            ))}
            {tab === 'stock' && v.empty.length > 0 && (
              <>
                <p className="type-title-sm text-on-surface-variant px-1 mt-2">Used up</p>
                {list(v.empty, null)}
              </>
            )}
            {tab === 'products' && (
              <>
                <TextField label="Search products" value={query} onChange={e => setQuery(e.target.value)} type="search" />
                {list(filtered, <EmptyState icon="search" title={v.all.length ? 'No matches' : 'No products yet'}
                  body={v.all.length ? 'Try another word.' : 'Products are the parts and fluids you buy and use.'}
                  action={!v.all.length && <Button icon="add" onClick={() => open({ kind: 'product' })}>New product</Button>} />)}
              </>
            )}
            {tab === 'receipts' && (
              <>
                <Card variant="outlined" className="py-1 overflow-hidden">
                  {v.receipts.length ? v.receipts.map(r => (
                    <ListItem key={r.id} onClick={() => open({ kind: 'receipt', receiptId: r.id })}
                      leading={<Avatar icon="receipt_long" tone="secondary" />}
                      headline={r.title} supporting={`${day(r.date)}${r.store && r.store !== r.title ? ` · ${r.store}` : ''} · ${r.count} item${r.count === 1 ? '' : 's'}`}
                      trailing={<span className="flex items-center gap-2">
                        {r.left > 0 && <Pill tone="info">{r.left} left</Pill>}
                        {r.total != null && <span className="text-on-surface">{usd(r.total)}</span>}
                      </span>} />
                  )) : <EmptyState icon="receipt_long" title="No parts receipts yet" body="Receipts for things you buy go here. Shop bills live with the service they paid for."
                    action={<Button icon="add" onClick={() => open({ kind: 'receipt' })}>Add receipt</Button>} />}
                </Card>
                {v.bills > 0 && (
                  <p className="type-body-sm text-on-surface-variant px-1 flex gap-2"><Icon name="info" size={16} className="mt-px" />
                    {v.bills} shop bill{v.bills === 1 ? ' is' : 's are'} attached to services instead; open them from Services.</p>
                )}
              </>
            )}
          </div>
          <div className="max-lg:hidden sticky top-6">
            {sel && tab !== 'receipts'
              ? <ProductDetail s={sel} data={data} title={titleOf(sel.product)} sub={subOf(sel.product)} />
              : <Card variant="filled" className="p-8"><EmptyState icon={tab === 'receipts' ? 'receipt_long' : 'inventory_2'}
                  title={tab === 'receipts' ? 'Tap a receipt to open it' : 'Pick a product'}
                  body={tab === 'receipts' ? 'You can edit lines, fix prices, or add the photo.' : 'Where it came from, where it went, and what’s left.'} /></Card>}
          </div>
        </div>
      )}

      <Dialog open={Boolean(sel) && !desktop && tab !== 'receipts'} onClose={() => setSelected(null)} title={sel ? titleOf(sel.product) : ''} size="lg">
        {sel && <ProductDetail s={sel} data={data} title={titleOf(sel.product)} sub={subOf(sel.product)} compact />}
      </Dialog>

      {rotate && (
        <RotateTiresModal vehicle={vehicle} lives={g.tireLives} events={data.tireEvents} products={g.products} categories={g.categories}
          onClose={() => setRotate(false)}
          onSaved={async () => { setRotate(false); await refreshVehicle(); reload() }}
          onEditProduct={id => { setRotate(false); open({ kind: 'product', productId: id }) }} />
      )}
    </Page>
  )
}

// Numbers for the page, computed once per load.
function view(data: StockData) {
  const g = data.garage
  const all = [...g.stock.values()].sort((a, b) => a.product.name.localeCompare(b.product.name))
  const inStock = all.filter(s => s.onHand > 0)
  const empty = all.filter(s => s.onHand <= 0 && (s.purchased > 0 || s.consumed > 0))
  const since = format(subMonths(new Date(), 12), 'yyyy-MM-dd')
  let spent12 = 0, used12 = 0
  const recent = new Set<string>()
  for (const s of all) {
    for (const b of s.lots) if (b.lot.date && b.lot.date >= since && b.lot.unitCost != null) {
      spent12 += b.lot.qty * b.lot.unitCost
      if (b.lot.kind === 'receipt') recent.add(b.lot.sourceId)
    }
    for (const a of s.allocations) {
      if (a.draw.kind !== 'service' || !a.draw.date || a.draw.date < since || !a.lotId) continue
      const lot = s.lots.find(b => b.lot.id === a.lotId)
      if (lot?.lot.unitCost != null) used12 += a.qty * lot.lot.unitCost
    }
  }
  const productName = (id: string) => g.products.find(p => p.id === id)?.name ?? 'Item'
  const left = new Map<string, number>()
  for (const s of all) for (const b of s.lots) if (b.lot.kind === 'receipt' && b.remaining > 0) left.set(b.lot.sourceId, (left.get(b.lot.sourceId) ?? 0) + 1)
  const withItems = new Set(g.items.map(i => i.receipt_id))
  const receipts = [...g.receipts.values()]
    .filter(r => withItems.has(r.id) || (!r.no_products && r.image_path == null))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .map(r => {
      const its = g.items.filter(i => i.receipt_id === r.id)
      const sum = its.reduce((t, i) => t + (i.unit_cost != null ? Number(i.unit_cost) * Number(i.qty) : 0), 0)
      return {
        id: r.id, date: r.date, store: r.store, count: its.length, left: left.get(r.id) ?? 0,
        title: receiptTitle({ store: r.store, products: its.map(i => productName(i.product_id)), services: [], noProducts: r.no_products }),
        total: r.total_cost != null ? Number(r.total_cost) : sum || null,
      }
    })
  const bills = [...g.receipts.values()].filter(r => !withItems.has(r.id) && (r.no_products || r.image_path)).length
  return {
    all, inStock, empty, receipts, bills, spent12, used12, receipts12: recent.size,
    value: inStock.reduce((t, s) => t + s.value, 0),
  }
}

interface Out { id: string; kind: 'service' | 'adjustment'; sourceId: string; date: string | null; qty: number; note: string | null; cost: number }
interface Row { key: string; date: string | null; in: boolean; title: string; detail: string; qty: number; onClick?: () => void }

// One product: what's left, where it came from, where it went.
function ProductDetail({ s, data, title, sub, compact }: { s: ProductStock; data: StockData; title: string; sub: string; compact?: boolean }) {
  const { open } = useForms()
  const router = useRouter()
  const g = data.garage
  const p = s.product as ProductU
  const usedFor = g.links.filter(l => l.product_id === p.id).map(l => g.categories.find(c => c.id === l.category_id)?.name).filter(Boolean) as string[]
  const buy = data.buyLinks.filter(l => l.product_id === p.id)

  // Merge stock in (lots) and stock out (draws) into one dated history, newest first.
  const outs = new Map<string, Out>()
  for (const a of s.allocations) {
    const lot = a.lotId ? s.lots.find(b => b.lot.id === a.lotId) : undefined
    const cur = outs.get(a.draw.id) ?? { id: a.draw.id, kind: a.draw.kind, sourceId: a.draw.sourceId, date: a.draw.date, qty: 0, note: a.draw.note, cost: 0 }
    cur.qty += a.qty
    cur.cost += lot?.lot.unitCost != null ? a.qty * lot.lot.unitCost : 0
    outs.set(a.draw.id, cur)
  }
  const rows: Row[] = [
    ...s.lots.map((b): Row => {
      const r = b.lot.kind === 'receipt' ? g.receipts.get(b.lot.sourceId) : undefined
      return {
        key: b.lot.id, date: b.lot.date, in: true, qty: b.lot.qty,
        title: b.lot.kind === 'receipt' ? `Bought${r?.store ? ` at ${r.store}` : ''}` : 'Added by hand',
        detail: [b.lot.unitCost != null ? `${usd(b.lot.unitCost)} each` : null, b.remaining > 0 ? `${fmtQty(+b.remaining.toFixed(3), s.unit)} still left` : 'all used'].filter(Boolean).join(' · '),
        onClick: r ? () => open({ kind: 'receipt', receiptId: r.id }) : undefined,
      }
    }),
    ...[...outs.values()].map((o): Row => {
      const log = o.kind === 'service' ? data.logs.get(o.sourceId) : undefined
      return {
        key: o.id, date: o.date, in: false, qty: o.qty,
        title: o.kind === 'service' ? (log?.service_type ?? 'Service') : 'Removed',
        detail: [o.kind === 'service' && log ? `${log.odometer.toLocaleString()} mi` : o.note, o.cost ? usd(o.cost) : null].filter(Boolean).join(' · '),
        onClick: log ? () => router.push(`/service?log=${log.id}`) : undefined,
      }
    }),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || (a.in === b.in ? 0 : a.in ? 1 : -1))

  return (
    <div className={compact ? 'flex flex-col gap-5' : 'flex flex-col gap-5 rounded-[28px] bg-surface-container-low p-6'}>
      {!compact && (
        <div className="flex items-start gap-4">
          <Avatar icon={iconFor(`${title} ${p.name}`)} size={48} />
          <div className="flex-1 min-w-0">
            <p className="type-headline-sm text-on-surface truncate">{title}</p>
            {sub && <p className="type-body text-on-surface-variant truncate">{sub}</p>}
          </div>
          <IconButton icon="edit" label="Edit product" onClick={() => open({ kind: 'product', productId: p.id })} />
        </div>
      )}
      {compact && sub && <p className="type-body text-on-surface-variant -mt-2">{sub}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Metric label="On hand" value={s.onHand > 0 ? fmtQty(+s.onHand.toFixed(3), s.unit) : 'None'} sub={s.value > 0 ? `${usd(s.value)} worth` : undefined} className="bg-surface-container" />
        <Metric label="Used so far" value={fmtQty(+s.consumed.toFixed(3), s.unit)} sub={`of ${fmtQty(+s.purchased.toFixed(3), s.unit)} bought`} className="bg-surface-container" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button icon="build" disabled={s.onHand <= 0} onClick={() => open({ kind: 'service', productId: p.id })}>Use in a service</Button>
        <Button variant="tonal" icon="add" onClick={() => open({ kind: 'stock', mode: 'add', productId: p.id })}>Add</Button>
        <Button variant="tonal" icon="remove" disabled={s.onHand <= 0} onClick={() => open({ kind: 'stock', mode: 'remove', productId: p.id })}>Remove</Button>
        {compact && <Button variant="text" icon="edit" onClick={() => open({ kind: 'product', productId: p.id })}>Edit</Button>}
      </div>

      {(usedFor.length > 0 || buy.length > 0) && (
        <div className="flex flex-col gap-3">
          {usedFor.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="type-label-lg text-on-surface-variant mr-1">Used for</span>
              {usedFor.map(n => <Chip key={n} icon="build">{n}</Chip>)}
            </div>
          )}
          {buy.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="type-label-lg text-on-surface-variant mr-1">Buy again</span>
              {buy.map(l => (
                <a key={l.id} href={l.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-outline-variant type-label-lg text-primary hover:bg-primary/8">
                  {l.label}<Icon name="open_in_new" size={16} />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <p className="type-title-sm text-on-surface-variant mb-1">History</p>
        {rows.length === 0 ? <p className="type-body text-on-surface-variant py-3">Nothing yet. Add a receipt or stock to start counting.</p> : (
          <div className="-mx-4">
            {rows.map(r => (
              <ListItem key={r.key} dense onClick={r.onClick}
                leading={<span className={`w-9 h-9 rounded-full flex items-center justify-center ${r.in ? 'bg-success-container text-on-success-container' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                  <Icon name={r.in ? 'arrow_downward' : 'arrow_upward'} size={18} /></span>}
                headline={r.title} supporting={`${day(r.date)}${r.detail ? ` · ${r.detail}` : ''}`}
                trailing={<span className={r.in ? 'text-[var(--md-success)]' : 'text-on-surface'}>{r.in ? '+' : '−'}{fmtQty(+r.qty.toFixed(3), s.unit)}</span>} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
