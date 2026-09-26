'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useRouter } from 'next/navigation'
import { Plus, Package, Receipt as ReceiptIcon, Image as ImageIcon, AlertTriangle, Wrench, Ban, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { read, runSave, step } from '@/lib/recover'
import ActionError from '@/components/ui/ActionError'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { computeStock, lotBalancesByItem, type LotBalance, type ProductStock } from '@/lib/inventory'
import { fmtQty, fmtNum } from '@/lib/units'
import { receiptTitle, receiptWhere } from '@/lib/receipts'
import type { ProductType } from '@/lib/productTypes'
import { allTireLives, tireProductChoices, type Tire, type TireEvent } from '@/lib/tires'
import TireCard from '@/components/tires/TireCard'
import TirePanel from '@/components/tires/TirePanel'
import RotateTiresModal from '@/components/tires/RotateTiresModal'
import { getCache, setCache } from '@/lib/cache'
import type {
  Product, Receipt, ReceiptItem, InventoryAdjustment, ServiceProductUsage, ServiceLog, ServiceCategory,
} from '@/lib/types'
import RecordWizard, { type WizardSeed } from '@/components/records/RecordWizard'
import UseProductModal from './UseProductModal'
import ProductPeek from './ProductPeek'
import type { ProductLink } from '@/lib/types'

interface PastReceipt { logId: string; imagePath: string; date: string | null; label: string }

type ProductU = Product & { unit?: string }
type PastLog = ServiceLog
interface LogReceiptLink { log_id: string; receipt_id: string }
interface Snapshot {
  products: ProductU[]; receipts: Receipt[]; items: ReceiptItem[]
  usage: ServiceProductUsage[]; adjustments: InventoryAdjustment[]; pastLogs: PastLog[]
  allLogs: PastLog[]; links: LogReceiptLink[]; categories: ServiceCategory[]
  productTypes: ProductType[]; tablesReady: boolean
}

interface InventoryTabProps {
  /** Hand a product back to the catalog editor — the one place editing lives. */
  onEditProduct?: (productId: string) => void
}

export default function InventoryTab({ onEditProduct }: InventoryTabProps = {}) {
  const { user } = useAuth()
  const { vehicle, refresh: refreshVehicle } = useVehicle()
  const [loading, setLoading] = useState(true)
  const [tablesReady, setTablesReady] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [products, setProducts] = useState<ProductU[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [usage, setUsage] = useState<ServiceProductUsage[]>([])
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([])
  const [pastLogs, setPastLogs] = useState<PastLog[]>([])
  const [allLogs, setAllLogs] = useState<PastLog[]>([])
  const [links, setLinks] = useState<LogReceiptLink[]>([])
  const [categories, setCategories] = useState<ServiceCategory[]>([])
  const [productTypes, setProductTypes] = useState<ProductType[]>([])
  const [modal, setModal] = useState<{ past: PastReceipt | null } | null>(null)
  const [detail, setDetail] = useState<Receipt | null>(null)
  const [useStock, setUseStock] = useState<ProductStock | null>(null)
  const [peekId, setPeekId] = useState<string | null>(null)
  const [tires, setTires] = useState<Tire[]>([])
  const [tireEvents, setTireEvents] = useState<TireEvent[]>([])
  const [showTires, setShowTires] = useState(false)
  const [showRotate, setShowRotate] = useState(false)
  const [productLinks, setProductLinks] = useState<ProductLink[]>([])
  const [catLinks, setCatLinks] = useState<{ product_id: string; category_id: string }[]>([])
  const router = useRouter()

  const cacheFirstFor = useRef<string | null>(null)
  const load = useCallback(async () => {
    if (!user) return
    const uid = user.id
    const key = `inventory:${uid}`

    const apply = (s: Snapshot) => {
      setProducts(s.products); setReceipts(s.receipts); setItems(s.items)
      setUsage(s.usage); setAdjustments(s.adjustments); setPastLogs(s.pastLogs)
      setAllLogs(s.allLogs ?? []); setLinks(s.links ?? [])
      setCategories(s.categories ?? []); setProductTypes(s.productTypes ?? [])
      setTablesReady(s.tablesReady)
    }

    const fetchFresh = async () => {
      const { data: prods } = await read(supabase.from('products').select('*').eq('user_id', uid).order('name'))
      let ready = true
      let rec: Receipt[] = [], its: ReceiptItem[] = [], use: ServiceProductUsage[] = []
      let adj: InventoryAdjustment[] = [], lnk: LogReceiptLink[] = []
      const rq = await read(supabase.from('receipts').select('*').eq('user_id', uid).order('date', { ascending: false }))
      if (rq.error) {
        ready = false
      } else {
        rec = (rq.data ?? []) as Receipt[]
        const [itemsQ, usageQ, adjQ, linkQ] = await Promise.all([
          supabase.from('receipt_items').select('*'),
          supabase.from('service_product_usage').select('*'),
          supabase.from('inventory_adjustments').select('*'),
          supabase.from('service_log_receipts').select('*'),
        ])
        its = (itemsQ.data ?? []) as ReceiptItem[]
        use = (usageQ.data ?? []) as ServiceProductUsage[]
        adj = (adjQ.data ?? []) as InventoryAdjustment[]
        lnk = (linkQ.data ?? []) as LogReceiptLink[]
      }
      // All logs, not just the ones carrying an image: usage rows can point at any
      // service, and FIFO order depends on those dates.
      const [{ data: pl }, { data: cats }, typesQ] = await Promise.all([
        supabase.from('service_logs').select('*').eq('user_id', uid).order('date', { ascending: false }),
        vehicle
          ? supabase.from('service_categories').select('*').eq('vehicle_id', vehicle.id).order('name')
          : Promise.resolve({ data: [] as ServiceCategory[] }),
        supabase.from('product_types').select('*').eq('user_id', uid).order('name'),
      ])
      // Peek-card extras; absent tables shouldn't break the inventory list.
      try {
        const [tq, teq] = await Promise.all([
          supabase.from('tires').select('*'),
          vehicle
            ? supabase.from('tire_events').select('*').eq('vehicle_id', vehicle.id)
            : Promise.resolve({ data: [] as TireEvent[] }),
        ])
        setTires((tq.data ?? []) as Tire[])
        setTireEvents((teq.data ?? []) as TireEvent[])
      } catch { /* migration not run yet — the tire card just stays quiet */ }
      try {
        const [pl, cl] = await Promise.all([
          supabase.from('product_links').select('*'),
          supabase.from('product_category_links').select('*'),
        ])
        setProductLinks((pl.data ?? []) as ProductLink[])
        setCatLinks((cl.data ?? []) as { product_id: string; category_id: string }[])
      } catch { /* peek just shows less */ }
      const allLogs = (pl ?? []) as PastLog[]
      const snap: Snapshot = {
        products: (prods ?? []) as ProductU[], receipts: rec, items: its,
        usage: use, adjustments: adj,
        pastLogs: allLogs.filter(l => l.receipt_url),
        allLogs, links: lnk, categories: (cats ?? []) as ServiceCategory[],
        productTypes: (typesQ.data ?? []) as ProductType[], tablesReady: ready,
      }
      setCache(key, snap)
      apply(snap)
    }

    // First view of this session: show cached data instantly and revalidate quietly.
    // Returning to a backgrounded browser tab won't flip to a blocking spinner.
    if (cacheFirstFor.current !== uid) {
      cacheFirstFor.current = uid
      const cached = getCache<Snapshot>(key)
      if (cached) { apply(cached); setLoading(false); fetchFresh().catch(() => {}); return }
    }
    if (getCache(key) === undefined) setLoading(true) // spinner only when there's nothing to show
    try {
      await fetchFresh()
    } catch { /* keep showing what we have */ } finally {
      setLoading(false)
    }
  }, [user?.id, vehicle?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // The Services health map sends tire clicks here.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tires') === '1') setShowTires(true)
  }, [])

  const logDates = useMemo(() => Object.fromEntries(allLogs.map(l => [l.id, l.date])), [allLogs])
  const stock = useMemo(
    () => computeStock(products, receipts, items, usage, adjustments, id => logDates[id] ?? null),
    [products, receipts, items, usage, adjustments, logDates],
  )
  const lots = useMemo(() => lotBalancesByItem(stock), [stock])
  const productName = (id: string) => products.find(p => p.id === id)?.name ?? 'Unknown product'
  const productUnit = (id: string) => products.find(p => p.id === id)?.unit ?? 'each'
  // What the thing IS, for headlines. Falls back to the model when untyped, so
  // an unclassified product still reads as something rather than nothing.
  const typeNameOf = (id: string) => {
    const p = products.find(x => x.id === id)
    return productTypes.find(t => t.id === p?.product_type_id)?.name ?? p?.name ?? 'Unknown product'
  }

  // Past receipts not yet pulled into inventory (no receipt row reuses their image).
  const importedImages = useMemo(() => new Set(receipts.map(r => r.image_path).filter(Boolean)), [receipts])
  const pending = pastLogs.filter(pl => !importedImages.has(pl.receipt_url))

  const tracked = [...stock.values()].filter(s => s.purchased > 0 || s.consumed > 0)
  const tireLives = allTireLives(tires, tireEvents, vehicle?.odometer ?? 0)
  const hasTireData = tireLives.some(l => !l.retired)
  const tireProducts = tireProductChoices(products, productTypes)

  // What a receipt actually carries, for the Products / Services / Both flag.
  const itemsByReceipt = useMemo(() => {
    const m = new Map<string, ReceiptItem[]>()
    for (const it of items) m.set(it.receipt_id, [...(m.get(it.receipt_id) ?? []), it])
    return m
  }, [items])
  // Two different relationships, deliberately kept apart:
  //   linked  — a service drew products from this receipt (DIY provenance)
  //   shop    — the receipt itself carries shop labour, i.e. some attached
  //             service was performed_by 'shop'. Only this earns a Services flag.
  const logById = useMemo(() => new Map(allLogs.map(l => [l.id, l])), [allLogs])
  const receiptFacts = useCallback((receiptId: string) => {
    const logIds = new Set(links.filter(l => l.receipt_id === receiptId).map(l => l.log_id))
    const itemIds = new Set((itemsByReceipt.get(receiptId) ?? []).map(i => i.id))
    for (const u of usage) if (u.receipt_item_id && itemIds.has(u.receipt_item_id)) logIds.add(u.log_id)
    let shopServices = 0
    for (const id of logIds) if (logById.get(id)?.performed_by === 'shop') shopServices++
    return { linked: logIds.size, shopServices, logIds: [...logIds] }
  }, [links, usage, itemsByReceipt, logById])

  // A lot's human label: which receipt (and when) the stock came from.
  const lotLabel = useCallback((b: LotBalance) => {
    if (b.lot.kind === 'adjustment') return 'Manual stock'
    const r = receipts.find(x => x.id === b.lot.sourceId)
    const when = r?.date ? format(parseISO(r.date), 'MMM d, yyyy') : 'undated'
    return `${r?.store || 'Receipt'} · ${when}`
  }, [receipts])

  // Marking a past service receipt "no products" = a receipt row with no lines,
  // which also drops it out of the import list by the existing image-path rule.
  async function markNoProducts(pl: PastLog) {
    if (!user) return
    const id = crypto.randomUUID()
    // A stable id, so a retry rewrites the same row instead of adding another.
    const res = await runSave(async () => {
      await step(() => supabase.from('receipts').upsert({
        id, user_id: user.id, date: pl.date, store: null,
        image_path: pl.receipt_url, no_products: true,
      }))
      await step(() => supabase.from('service_log_receipts').upsert({ log_id: pl.id, receipt_id: id }))
    })
    if (!res.ok) setError(res.message)
    load()
  }

  async function viewImage(path: string) {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
      <ActionError message={error} onDismiss={() => setError(null)} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-muted text-sm">Track what you've bought, how much is left, and where it went.</p>
        {tablesReady && (
          <button onClick={() => setModal({ past: null })} className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold rounded-2xl px-4 py-2 text-sm transition-colors shadow-lg shadow-accent/20">
            <Plus size={15} /> Add receipt
          </button>
        )}
      </div>

      {!tablesReady && (
        <div className="bg-warn/10 border border-warn/20 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-warn shrink-0 mt-0.5" />
          <div>
            <p className="text-foreground font-medium text-sm">Inventory isn’t set up yet</p>
            <p className="text-muted text-sm mt-1">Run <code className="text-accent">supabase/add_inventory_tables.sql</code> in the Supabase SQL editor, then refresh. Your {pending.length} past receipt{pending.length === 1 ? '' : 's'} will be ready to import.</p>
          </div>
        </div>
      )}

      {/* Stock */}
      {(tracked.length > 0 || hasTireData) && (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-3">On hand</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Tires first: the most valuable stock most garages hold. */}
            {hasTireData && <TireCard lives={tireLives} onOpen={() => setShowTires(true)} trackPositions={vehicle?.track_tire_positions !== false} />}
            {tracked.map(s => {
              const empty = s.onHand <= 0
              const lotCount = s.lots.filter(b => b.remaining > 0).length
              return (
                <div key={s.product.id} className="bg-surface border border-border rounded-2xl p-4">
                  <button onClick={() => setPeekId(s.product.id)} className="text-left w-full group">
                    <p className="font-bold text-foreground truncate group-hover:text-accent transition-colors">
                      {typeNameOf(s.product.id)}
                    </p>
                    <p className="text-muted text-xs truncate">
                      {[s.product.name, s.product.brand].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                  <p className={`text-2xl font-bold mt-2 ${empty ? 'text-faint' : 'text-accent'}`}>
                    {empty ? 'None left' : fmtQty(s.onHand, s.unit)}
                  </p>
                  <p className="text-faint text-xs mt-0.5">
                    {s.consumed > 0
                      ? `${fmtNum(s.consumed)} of ${fmtNum(s.purchased)} used`
                      : `${fmtQty(s.purchased, s.unit)} bought · none used yet`}
                    {s.value > 0 && ` · $${s.value.toFixed(2)} left`}
                  </p>
                  {/* Where the consumption came from, so a card is never unexplained. */}
                  {s.adjustedOut > 0 && s.usedInService === 0 && (
                    <p className="text-faint text-[11px] mt-1.5">Used before tracking started</p>
                  )}
                  {lotCount > 1 && (
                    <p className="text-faint text-[11px] mt-1.5">Across {lotCount} lots</p>
                  )}
                  <button
                    onClick={() => setUseStock(s)}
                    disabled={empty}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 bg-accent/10 text-accent border border-accent/20 rounded-xl py-2 text-xs font-semibold hover:bg-accent/20 disabled:opacity-40 disabled:hover:bg-accent/10 transition-colors"
                  >
                    <Wrench size={13} /> Use in a service
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Past receipts to import */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-1">Past receipts to import <span className="text-faint font-normal">· {pending.length}</span></h3>
          <p className="text-faint text-xs mb-3">These are on your old service records. We don’t know what was on them yet — add the details to count them toward inventory.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {pending.map(pl => (
              <div key={pl.id} className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center shrink-0"><ReceiptIcon size={18} className="text-muted" /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">{pl.service_type}</p>
                  <p className="text-faint text-xs">{pl.date ? format(parseISO(pl.date), 'MMM d, yyyy') : '—'} · details unknown</p>
                </div>
                <button onClick={() => viewImage(pl.receipt_url!)} className="text-muted hover:text-accent p-1.5" title="View image"><ImageIcon size={15} /></button>
                {tablesReady && (
                  <>
                    <button onClick={() => markNoProducts(pl)}
                      title="Labour or services only — nothing to stock"
                      className="text-muted hover:text-foreground p-1.5 shrink-0"><Ban size={15} /></button>
                    <button onClick={() => setModal({ past: { logId: pl.id, imagePath: pl.receipt_url!, date: pl.date, label: pl.service_type } })}
                      className="bg-accent/10 text-accent border border-accent/20 rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-accent/20 transition-colors shrink-0">
                      Add details
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Imported receipts */}
      {receipts.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-3">Receipts</h3>
          <div className="space-y-3">
            {receipts.map(r => {
              const rItems = items.filter(i => i.receipt_id === r.id)
              const { linked, shopServices, logIds } = receiptFacts(r.id)
              const linkedLogs = logIds.map(id => logById.get(id)).filter(Boolean) as PastLog[]
              const title = receiptTitle({
                store: r.store,
                products: rItems.map(it => typeNameOf(it.product_id)),
                services: linkedLogs.map(l => l.service_type),
                noProducts: r.no_products,
              })
              const hasProducts = rItems.length > 0
              const flags: { label: string; cls: string }[] = []
              if (hasProducts) flags.push({ label: 'Products', cls: 'bg-accent/10 text-accent border-accent/20' })
              // Shop labour on the receipt itself — NOT merely being used by a DIY job.
              if (shopServices > 0) flags.push({ label: 'Services', cls: 'bg-success/10 text-success border-success/20' })
              if (!hasProducts && r.no_products && shopServices === 0) flags.push({ label: 'No products', cls: 'bg-surface-2 text-faint border-border' })
              if (!hasProducts && !r.no_products && linked === 0) flags.push({ label: 'Needs details', cls: 'bg-warn/10 text-warn border-warn/20' })
              return (
                <button key={r.id} onClick={() => setDetail(r)}
                  className="w-full text-left bg-surface border border-border rounded-2xl p-4 hover:border-accent/40 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <p className="font-medium text-foreground text-sm">{title}</p>
                      <span className="text-faint text-xs">
                        {receiptWhere(r.store, r.date ? format(parseISO(r.date), 'MMM d, yyyy') : null)}
                      </span>
                      {flags.map(f => (
                        <span key={f.label} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${f.cls}`}>{f.label}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {r.total_cost != null && <span className="text-foreground text-sm font-semibold">${Number(r.total_cost).toFixed(2)}</span>}
                      {r.image_path && <span onClick={e => { e.stopPropagation(); viewImage(r.image_path!) }} className="text-muted hover:text-accent cursor-pointer" title="View image"><ImageIcon size={15} /></span>}
                    </div>
                  </div>
                  <div className="mt-2 divide-y divide-border">
                    {rItems.map(it => {
                      const bal = lots.get(it.id)
                      const unit = productUnit(it.product_id)
                      const remaining = bal?.remaining ?? Number(it.qty)
                      return (
                        <div key={it.id} className="flex items-center justify-between py-1.5 text-sm">
                          <span className="text-foreground truncate">{productName(it.product_id)}</span>
                          <span className={`text-xs shrink-0 ${remaining <= 0 ? 'text-faint/70' : 'text-faint'}`}>
                            {remaining <= 0
                              ? `all ${fmtQty(Number(it.qty), unit)} used`
                              : `${fmtNum(remaining)} of ${fmtQty(Number(it.qty), unit)} left`}
                          </span>
                        </div>
                      )
                    })}
                    {/* Services were invisible here before — a shop bill looked empty */}
                    {linkedLogs.map(l => (
                      <div key={l.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                        <span className="text-foreground truncate flex items-center gap-1.5">
                          <Wrench size={11} className="text-faint shrink-0" />{l.service_type}
                        </span>
                        <span className="text-faint text-xs shrink-0">
                          {l.performed_by === 'shop' ? 'Shop' : 'DIY'}
                          {l.cost != null && ` · $${Number(l.cost).toFixed(2)}`}
                        </span>
                      </div>
                    ))}
                    {rItems.length === 0 && linkedLogs.length === 0 && (
                      <p className="text-faint text-xs py-1.5">
                        {r.no_products ? 'Labour / services only — nothing stocked.' : 'No line items yet — tap to add them.'}
                      </p>
                    )}
                  </div>
                  {linked > 0 && (
                    <p className="text-faint text-[11px] mt-2">Tap to see where it was used</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {tablesReady && tracked.length === 0 && pending.length === 0 && receipts.length === 0 && (
        <div className="text-center py-16">
          <Package size={40} className="text-faint mx-auto mb-3" />
          <p className="text-muted font-medium">No inventory yet</p>
          <p className="text-faint text-sm mt-1">Add a receipt for something you bought to start tracking stock.</p>
          <button onClick={() => setModal({ past: null })} className="mt-4 text-accent text-sm font-medium">Add your first receipt →</button>
        </div>
      )}

      {modal && (
        <RecordWizard
          seed={modal.past
            ? { past: { logId: modal.past.logId, imagePath: modal.past.imagePath, date: modal.past.date } }
            : undefined}
          products={products}
          categories={categories}
          logs={allLogs}
          stock={stock}
          tireLives={tireLives}
          tireProducts={tireProducts}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}

      {detail && (
        <RecordWizard
          seed={{
            receipt: detail,
            items: items.filter(i => i.receipt_id === detail.id),
            logIds: links.filter(l => l.receipt_id === detail.id).map(l => l.log_id),
          }}
          products={products}
          categories={categories}
          logs={allLogs}
          usage={usage}
          stock={stock}
          tireLives={tireLives}
          tireProducts={tireProducts}
          onClose={() => setDetail(null)}
          onSaved={() => { setDetail(null); load() }}
        />
      )}

      {peekId && (() => {
        const p = products.find(x => x.id === peekId)
        if (!p) return null
        const tagged = new Set(catLinks.filter(c => c.product_id === peekId).map(c => c.category_id))
        return (
          <ProductPeek
            product={p}
            type={productTypes.find(t => t.id === p.product_type_id) ?? null}
            stock={stock.get(peekId) ?? null}
            links={productLinks.filter(l => l.product_id === peekId)}
            categories={categories.filter(c => tagged.has(c.id))}
            onClose={() => setPeekId(null)}
            onEdit={() => { setPeekId(null); onEditProduct?.(peekId) }}
          />
        )
      })()}

      {showTires && vehicle && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) setShowTires(false) }}>
          <div className="bg-surface border border-border rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
              <div>
                <h3 className="font-bold text-foreground text-lg">Tires</h3>
                <p className="text-faint text-xs">{vehicle.odometer.toLocaleString()} mi on the clock</p>
              </div>
              <button onClick={() => setShowTires(false)} className="text-muted hover:text-foreground"><X size={20} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-6">
              <TirePanel
                lives={tireLives}
                currentOdometer={vehicle.odometer}
                productName={id => products.find(x => x.id === id)?.name ?? 'Tire'}
                trackPositions={vehicle.track_tire_positions !== false}
                onRotate={() => setShowRotate(true)}
                onResumeTracking={async () => {
                  // Positions resume from the last recorded corners, which may be
                  // stale if rotations happened while tracking was off.
                  await runSave(() => step(() =>
                    supabase.from('vehicles').update({ track_tire_positions: true }).eq('id', vehicle.id)).then(() => {}))
                  await refreshVehicle()
                }}
              />
            </div>
          </div>
        </div>
      )}

      {showRotate && vehicle && (
        <RotateTiresModal
          vehicle={vehicle}
          lives={tireLives}
          events={tireEvents}
          products={products}
          categories={categories}
          onClose={() => setShowRotate(false)}
          onSaved={async () => { setShowRotate(false); await refreshVehicle(); load() }}
          onEditProduct={id => { setShowTires(false); onEditProduct?.(id) }}
        />
      )}

      {useStock && (
        <UseProductModal
          stock={useStock}
          lotLabel={lotLabel}
          onClose={() => setUseStock(null)}
          onSaved={() => { setUseStock(null); load() }}
        />
      )}
    </div>
  )
}
