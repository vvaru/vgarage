import type { Product, Receipt, ReceiptItem, InventoryAdjustment, ServiceProductUsage } from '@/lib/types'
import { fmtQty } from '@/lib/units'

export { fmtQty }

// ─────────────────────────────────────────────────────────────────────────────
// Stock is derived, never stored. Two kinds of row add stock and two kinds
// consume it, so both sides are normalised into Lots and Draws and then matched
// oldest-lot-first. Everything the UI shows — on hand, used, $ left, per-lot
// remaining — falls out of that single allocation, so the numbers cannot
// disagree with each other the way they did when each was computed separately.
// ─────────────────────────────────────────────────────────────────────────────

// Stock arriving: a receipt line item, or a positive manual adjustment
// (receipt-less opening stock).
export interface Lot {
  id: string                       // receipt_item.id, or `adj:<adjustment.id>`
  kind: 'receipt' | 'adjustment'
  sourceId: string                 // receipt.id, or adjustment.id
  productId: string
  date: string | null
  qty: number
  unitCost: number | null
}

// Stock leaving: a service usage, or a negative adjustment (used before
// tracking, spillage, correction).
export interface Draw {
  id: string
  kind: 'service' | 'adjustment'
  sourceId: string                 // service_logs.id, or adjustment.id
  productId: string
  date: string | null
  qty: number                      // always positive
  lotId: string | null             // lot the usage already named, if any
  note: string | null
}

export interface LotBalance {
  lot: Lot
  used: number
  remaining: number
}

// Which lot a draw actually came from. lotId null = drawn beyond known stock.
export interface Allocation {
  draw: Draw
  lotId: string | null
  qty: number
}

export interface ProductStock {
  product: Product
  unit: string
  purchased: number       // Σ lot quantities
  usedInService: number   // Σ service usage
  adjustedOut: number     // Σ |negative adjustments|
  consumed: number        // usedInService + adjustedOut — what "used" means on a card
  onHand: number          // purchased − consumed
  value: number           // Σ remaining-per-lot × that lot's unit cost
  lots: LotBalance[]      // oldest first
  allocations: Allocation[]
}

// Oldest first; unknown dates sort last so they never jump the queue.
const byDate = (a: { date: string | null }, b: { date: string | null }): number => {
  if (a.date === b.date) return 0
  if (!a.date) return 1
  if (!b.date) return -1
  return a.date < b.date ? -1 : 1
}

const n = (v: number | string | null): number | null => (v == null ? null : Number(v))

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const bucket = out.get(k)
    if (bucket) bucket.push(row)
    else out.set(k, [row])
  }
  return out
}

export function buildLots(receipts: Receipt[], items: ReceiptItem[], adjustments: InventoryAdjustment[]): Lot[] {
  const receiptDate = new Map(receipts.map(r => [r.id, r.date]))
  const lots: Lot[] = items.map(it => ({
    id: it.id,
    kind: 'receipt',
    sourceId: it.receipt_id,
    productId: it.product_id,
    date: receiptDate.get(it.receipt_id) ?? null,
    qty: Number(it.qty),
    unitCost: n(it.unit_cost),
  }))
  for (const a of adjustments) {
    const delta = Number(a.qty_delta)
    if (delta <= 0) continue
    lots.push({
      id: `adj:${a.id}`, kind: 'adjustment', sourceId: a.id, productId: a.product_id,
      date: a.date, qty: delta, unitCost: n(a.unit_cost),
    })
  }
  return lots.sort(byDate)
}

export function buildDraws(
  usage: ServiceProductUsage[],
  adjustments: InventoryAdjustment[],
  logDate: (logId: string) => string | null,
): Draw[] {
  const draws: Draw[] = usage.map(u => ({
    id: u.id, kind: 'service', sourceId: u.log_id, productId: u.product_id,
    date: logDate(u.log_id), qty: Number(u.qty), lotId: u.receipt_item_id, note: null,
  }))
  for (const a of adjustments) {
    const delta = Number(a.qty_delta)
    if (delta >= 0) continue
    draws.push({
      id: a.id, kind: 'adjustment', sourceId: a.id, productId: a.product_id,
      date: a.date, qty: -delta, lotId: null, note: a.note,
    })
  }
  return draws.sort(byDate)
}

// Match one product's draws against its lots, oldest lot first.
export function allocate(lots: Lot[], draws: Draw[]): { balances: LotBalance[]; allocations: Allocation[] } {
  const ordered = [...lots].sort(byDate)
  const queue = [...draws].sort(byDate)
  const balances = new Map<string, LotBalance>(ordered.map(lot => [lot.id, { lot, used: 0, remaining: lot.qty }]))
  const allocations: Allocation[] = []

  const take = (lotId: string, want: number): number => {
    const b = balances.get(lotId)
    if (!b || b.remaining <= 0) return 0
    const got = Math.min(want, b.remaining)
    b.used += got
    b.remaining -= got
    return got
  }

  // Pass 1 — honour lots a usage already recorded, so saved history never moves.
  const pinned = new Set<string>()
  for (const d of queue) {
    if (!d.lotId || !balances.has(d.lotId)) continue
    pinned.add(d.id)
    const got = take(d.lotId, d.qty)
    if (got > 0) allocations.push({ draw: d, lotId: d.lotId, qty: got })
    if (got < d.qty) allocations.push({ draw: d, lotId: null, qty: d.qty - got })
  }

  // Pass 2 — everything else (including negative adjustments) draws FIFO.
  let cursor = 0
  for (const d of queue) {
    if (pinned.has(d.id)) continue
    let need = d.qty
    while (need > 0 && cursor < ordered.length) {
      const b = balances.get(ordered[cursor].id)!
      if (b.remaining <= 0) { cursor++; continue }
      const got = take(b.lot.id, need)
      allocations.push({ draw: d, lotId: b.lot.id, qty: got })
      need -= got
    }
    if (need > 0) allocations.push({ draw: d, lotId: null, qty: need })
  }

  return { balances: ordered.map(l => balances.get(l.id)!), allocations }
}

export function computeStock(
  products: Product[],
  receipts: Receipt[],
  items: ReceiptItem[],
  usage: ServiceProductUsage[],
  adjustments: InventoryAdjustment[],
  logDate: (logId: string) => string | null = () => null,
): Map<string, ProductStock> {
  const lotsByProduct = groupBy(buildLots(receipts, items, adjustments), l => l.productId)
  const drawsByProduct = groupBy(buildDraws(usage, adjustments, logDate), d => d.productId)

  const out = new Map<string, ProductStock>()
  for (const product of products) {
    const lots = lotsByProduct.get(product.id) ?? []
    const draws = drawsByProduct.get(product.id) ?? []
    if (lots.length === 0 && draws.length === 0) continue

    const { balances, allocations } = allocate(lots, draws)
    const purchased = lots.reduce((s, l) => s + l.qty, 0)
    const usedInService = draws.filter(d => d.kind === 'service').reduce((s, d) => s + d.qty, 0)
    const adjustedOut = draws.filter(d => d.kind === 'adjustment').reduce((s, d) => s + d.qty, 0)
    const consumed = usedInService + adjustedOut

    out.set(product.id, {
      product,
      unit: (product as Product & { unit?: string }).unit ?? 'each',
      purchased,
      usedInService,
      adjustedOut,
      consumed,
      onHand: purchased - consumed,
      value: balances.reduce((s, b) => s + Math.max(0, b.remaining) * (b.lot.unitCost ?? 0), 0),
      lots: balances,
      allocations,
    })
  }
  return out
}

// Per-lot balances keyed by receipt_item id, for the receipts list.
export function lotBalancesByItem(stock: Map<string, ProductStock>): Map<string, LotBalance> {
  const out = new Map<string, LotBalance>()
  for (const s of stock.values()) {
    for (const b of s.lots) if (b.lot.kind === 'receipt') out.set(b.lot.id, b)
  }
  return out
}

// Oldest lot with stock left — what a "Use this" action should draw from first.
export function nextLot(stock: ProductStock): LotBalance | null {
  return stock.lots.find(b => b.remaining > 0) ?? null
}

// Walk lots oldest-first taking what's left of each, until the amount is met.
// `short` is whatever couldn't be covered by known stock.
export function planDraw(lots: LotBalance[], amount: number): { plan: { lot: LotBalance; qty: number }[]; short: number } {
  const plan: { lot: LotBalance; qty: number }[] = []
  let need = amount
  for (const b of lots) {
    if (need <= 0) break
    const take = Math.min(need, b.remaining)
    if (take > 0) { plan.push({ lot: b, qty: take }); need -= take }
  }
  return { plan, short: Math.max(0, need) }
}
