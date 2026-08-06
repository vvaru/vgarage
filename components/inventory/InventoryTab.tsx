'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { Plus, Package, Receipt as ReceiptIcon, Image as ImageIcon, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { computeStock, lotBalances, fmtQty } from '@/lib/inventory'
import { getCache, setCache } from '@/lib/cache'
import type { Product, Receipt, ReceiptItem, InventoryAdjustment, ServiceProductUsage } from '@/lib/types'
import ReceiptModal, { PastReceipt } from './ReceiptModal'

type ProductU = Product & { unit?: string }
interface PastLog { id: string; date: string; service_type: string; receipt_url: string }
interface Snapshot {
  products: ProductU[]; receipts: Receipt[]; items: ReceiptItem[]
  usage: ServiceProductUsage[]; adjustments: InventoryAdjustment[]; pastLogs: PastLog[]; tablesReady: boolean
}

export default function InventoryTab() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [tablesReady, setTablesReady] = useState(true)
  const [products, setProducts] = useState<ProductU[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [usage, setUsage] = useState<ServiceProductUsage[]>([])
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([])
  const [pastLogs, setPastLogs] = useState<PastLog[]>([])
  const [modal, setModal] = useState<{ past: PastReceipt | null } | null>(null)

  const cacheFirstFor = useRef<string | null>(null)
  const load = useCallback(async () => {
    if (!user) return
    const uid = user.id
    const key = `inventory:${uid}`

    const apply = (s: Snapshot) => {
      setProducts(s.products); setReceipts(s.receipts); setItems(s.items)
      setUsage(s.usage); setAdjustments(s.adjustments); setPastLogs(s.pastLogs)
      setTablesReady(s.tablesReady)
    }

    const fetchFresh = async () => {
      const { data: prods } = await supabase.from('products').select('*').eq('user_id', uid).order('name')
      let ready = true
      let rec: Receipt[] = [], its: ReceiptItem[] = [], use: ServiceProductUsage[] = [], adj: InventoryAdjustment[] = []
      const rq = await supabase.from('receipts').select('*').eq('user_id', uid).order('date', { ascending: false })
      if (rq.error) {
        ready = false
      } else {
        rec = (rq.data ?? []) as Receipt[]
        const [itemsQ, usageQ, adjQ] = await Promise.all([
          supabase.from('receipt_items').select('*'),
          supabase.from('service_product_usage').select('*'),
          supabase.from('inventory_adjustments').select('*'),
        ])
        its = (itemsQ.data ?? []) as ReceiptItem[]
        use = (usageQ.data ?? []) as ServiceProductUsage[]
        adj = (adjQ.data ?? []) as InventoryAdjustment[]
      }
      const { data: pl } = await supabase
        .from('service_logs')
        .select('id,date,service_type,receipt_url')
        .eq('user_id', uid)
        .not('receipt_url', 'is', null)
        .order('date', { ascending: false })
      const snap: Snapshot = {
        products: (prods ?? []) as ProductU[], receipts: rec, items: its,
        usage: use, adjustments: adj, pastLogs: (pl ?? []) as PastLog[], tablesReady: ready,
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
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const stock = useMemo(() => computeStock(products, items, usage, adjustments), [products, items, usage, adjustments])
  const lots = useMemo(() => lotBalances(items, usage), [items, usage])
  const productName = (id: string) => products.find(p => p.id === id)?.name ?? 'Unknown product'
  const productUnit = (id: string) => products.find(p => p.id === id)?.unit ?? 'each'

  // Past receipts not yet pulled into inventory (no receipt row reuses their image).
  const importedImages = useMemo(() => new Set(receipts.map(r => r.image_path).filter(Boolean)), [receipts])
  const pending = pastLogs.filter(pl => !importedImages.has(pl.receipt_url))

  const tracked = [...stock.values()].filter(s => s.purchased > 0 || s.adjusted !== 0 || s.used > 0)

  async function viewImage(path: string) {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-6">
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
      {tracked.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-foreground mb-3">On hand</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {tracked.map(s => {
              const unit = (s.product as ProductU).unit ?? 'each'
              const totalIn = s.purchased + Math.max(0, s.adjusted)
              return (
                <div key={s.product.id} className="bg-surface border border-border rounded-2xl p-4">
                  <p className="font-bold text-foreground truncate">{s.product.name}</p>
                  {s.product.brand && <p className="text-muted text-xs">{s.product.brand}</p>}
                  <p className="text-2xl font-bold text-accent mt-2">{fmtQty(Math.max(0, s.onHand), unit)}</p>
                  <p className="text-faint text-xs mt-0.5">
                    {fmtQty(s.used, unit)} used{totalIn > 0 ? ` of ${fmtQty(totalIn, unit)}` : ''}
                    {s.value > 0 ? ` · $${s.value.toFixed(2)} left` : ''}
                  </p>
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
                <button onClick={() => viewImage(pl.receipt_url)} className="text-muted hover:text-accent p-1.5" title="View image"><ImageIcon size={15} /></button>
                {tablesReady && (
                  <button onClick={() => setModal({ past: { logId: pl.id, imagePath: pl.receipt_url, date: pl.date, label: pl.service_type } })}
                    className="bg-accent/10 text-accent border border-accent/20 rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-accent/20 transition-colors shrink-0">
                    Add details
                  </button>
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
              return (
                <div key={r.id} className="bg-surface border border-border rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="font-medium text-foreground text-sm">{r.store || 'Receipt'}</p>
                      <span className="text-faint text-xs">{r.date ? format(parseISO(r.date), 'MMM d, yyyy') : ''}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {r.total_cost != null && <span className="text-foreground text-sm font-semibold">${Number(r.total_cost).toFixed(2)}</span>}
                      {r.image_path && <button onClick={() => viewImage(r.image_path!)} className="text-muted hover:text-accent" title="View image"><ImageIcon size={15} /></button>}
                    </div>
                  </div>
                  <div className="mt-2 divide-y divide-border">
                    {rItems.map(it => {
                      const bal = lots.get(it.id)
                      const unit = productUnit(it.product_id)
                      return (
                        <div key={it.id} className="flex items-center justify-between py-1.5 text-sm">
                          <span className="text-foreground truncate">{productName(it.product_id)}</span>
                          <span className="text-faint text-xs shrink-0">
                            {fmtQty(bal?.remaining ?? Number(it.qty), unit)} left of {fmtQty(Number(it.qty), unit)}
                          </span>
                        </div>
                      )
                    })}
                    {rItems.length === 0 && <p className="text-faint text-xs py-1.5">No line items.</p>}
                  </div>
                </div>
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
        <ReceiptModal
          products={products}
          past={modal.past}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
