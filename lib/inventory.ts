import type { Product, ReceiptItem, InventoryAdjustment, ServiceProductUsage } from '@/lib/types'

export interface ProductStock {
  product: Product
  purchased: number   // Σ receipt line quantities
  adjusted: number    // Σ manual adjustments (signed)
  used: number        // Σ service usage
  onHand: number      // purchased + adjusted − used
  value: number       // Σ remaining-per-lot × unit price (approx; lots only)
}

// Per-lot (receipt line) used + remaining, from the usage allocations.
export function lotBalances(
  items: ReceiptItem[],
  usage: ServiceProductUsage[],
): Map<string, { used: number; remaining: number }> {
  const usedByLot = new Map<string, number>()
  for (const u of usage) {
    if (u.receipt_item_id) usedByLot.set(u.receipt_item_id, (usedByLot.get(u.receipt_item_id) ?? 0) + Number(u.qty))
  }
  const out = new Map<string, { used: number; remaining: number }>()
  for (const it of items) {
    const used = usedByLot.get(it.id) ?? 0
    out.set(it.id, { used, remaining: Number(it.qty) - used })
  }
  return out
}

// Roll receipts, usage, and adjustments up into per-product stock.
export function computeStock(
  products: Product[],
  items: ReceiptItem[],
  usage: ServiceProductUsage[],
  adjustments: InventoryAdjustment[],
): Map<string, ProductStock> {
  const productById = new Map(products.map(p => [p.id, p]))
  const byProduct = new Map<string, ProductStock>()
  const ensure = (id: string): ProductStock | null => {
    const p = productById.get(id)
    if (!p) return null
    if (!byProduct.has(id)) byProduct.set(id, { product: p, purchased: 0, adjusted: 0, used: 0, onHand: 0, value: 0 })
    return byProduct.get(id)!
  }

  const lots = lotBalances(items, usage)

  for (const it of items) {
    const s = ensure(it.product_id); if (!s) continue
    s.purchased += Number(it.qty)
    const bal = lots.get(it.id)
    s.value += Math.max(0, bal?.remaining ?? 0) * (Number(it.unit_cost) || 0)
  }
  for (const u of usage) {
    const s = ensure(u.product_id); if (!s) continue
    s.used += Number(u.qty)
  }
  for (const a of adjustments) {
    const s = ensure(a.product_id); if (!s) continue
    s.adjusted += Number(a.qty_delta)
    if (Number(a.qty_delta) > 0 && a.unit_cost != null) s.value += Number(a.qty_delta) * Number(a.unit_cost)
  }
  for (const s of byProduct.values()) s.onHand = s.purchased + s.adjusted - s.used
  return byProduct
}

// A tidy amount label, e.g. "11 gal" or "2 each".
export function fmtQty(n: number, unit: string): string {
  const rounded = Math.round(n * 1000) / 1000
  const num = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(rounded < 10 ? 2 : 1)
  return `${num} ${unit}`
}
