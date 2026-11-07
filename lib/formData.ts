// What the data-entry forms need to know about the garage: products, stock lots
// (with each lot's receipt, so a part can say where it came from), categories,
// and tires. Loaded fresh when a form opens.
import { supabase } from '@/lib/supabase'
import { read } from '@/lib/recover'
import { computeStock, type ProductStock } from '@/lib/inventory'
import { allTireLives, tireProductChoices, type Tire, type TireEvent, type TireLife } from '@/lib/tires'
import type { InventoryAdjustment, Product, ProductCategoryLink, Receipt, ReceiptItem, ServiceCategory, ServiceLog, ServiceProductUsage } from '@/lib/types'

export type ProductU = Product & { unit?: string }

export interface GarageContext {
  products: ProductU[]
  categories: ServiceCategory[]
  links: ProductCategoryLink[]
  receipts: Map<string, Receipt>
  items: ReceiptItem[]
  usage: ServiceProductUsage[]
  /** Stock with the excluded service's own usage put back, so editing it can re-plan. */
  stock: Map<string, ProductStock>
  tireLives: TireLife[]
  tireProducts: { id: string; name: string }[]
  logs: Pick<ServiceLog, 'id' | 'date' | 'service_type' | 'odometer'>[]
}

export async function loadGarage(userId: string, vehicleId: string, currentOdo: number, excludeLogId?: string): Promise<GarageContext> {
  const [prods, cats, links, rcpts, items, usage, adj, logs, tires, events, types] = await Promise.all([
    read(supabase.from('products').select('*').eq('user_id', userId).order('name')),
    read(supabase.from('service_categories').select('*').eq('vehicle_id', vehicleId).order('name')),
    read(supabase.from('product_category_links').select('*')),
    read(supabase.from('receipts').select('*').eq('user_id', userId)),
    read(supabase.from('receipt_items').select('*')),
    read(supabase.from('service_product_usage').select('*')),
    read(supabase.from('inventory_adjustments').select('*').eq('user_id', userId)),
    read(supabase.from('service_logs').select('id,date,service_type,odometer').eq('user_id', userId)),
    read(supabase.from('tires').select('*')),
    read(supabase.from('tire_events').select('*').eq('vehicle_id', vehicleId)),
    read(supabase.from('product_types').select('id,name')),
  ])
  if (prods.error) throw new Error(prods.error.message)
  const products = (prods.data ?? []) as ProductU[]
  const categories = (cats.data ?? []) as ServiceCategory[]
  const receiptRows = (rcpts.data ?? []) as Receipt[]
  const itemRows = (items.data ?? []) as ReceiptItem[]
  const usageRows = (usage.data ?? []) as ServiceProductUsage[]
  const logRows = (logs.data ?? []) as GarageContext['logs']
  const dates = Object.fromEntries(logRows.map(l => [l.id, l.date]))
  const stock = computeStock(products, receiptRows, itemRows, usageRows.filter(u => u.log_id !== excludeLogId),
    (adj.data ?? []) as InventoryAdjustment[], id => dates[id] ?? null)
  const linkRows = (links.data ?? []) as ProductCategoryLink[]
  // A tire product is one typed or named as a tire, or one "used for" a tire category.
  const tireCats = new Set(categories.filter(c => c.tracks_tires).map(c => c.id))
  const byType = tireProductChoices(products, (types.data ?? []) as { id: string; name: string }[])
  const byLink = products.filter(p => linkRows.some(l => l.product_id === p.id && tireCats.has(l.category_id)) && !byType.some(t => t.id === p.id))
    .map(p => ({ id: p.id, name: [p.brand, p.name].filter(Boolean).join(' ') }))
  return {
    products, categories, links: linkRows,
    receipts: new Map(receiptRows.map(r => [r.id, r])), items: itemRows, usage: usageRows, stock,
    tireLives: allTireLives((tires.data ?? []) as Tire[], (events.data ?? []) as TireEvent[], currentOdo),
    tireProducts: [...byType, ...byLink],
    logs: logRows,
  }
}

/** "Costco · Jul 14" for a lot, or why it has no receipt. */
export function lotSource(ctx: GarageContext, lotId: string): string {
  if (lotId.startsWith('adj:')) return 'Added without a receipt'
  const item = ctx.items.find(i => i.id === lotId)
  const r = item && ctx.receipts.get(item.receipt_id)
  if (!r) return 'Receipt'
  const d = r.date ? new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: r.date.slice(0, 4) === String(new Date().getFullYear()) ? undefined : 'numeric' }) : null
  return [r.store || 'Receipt', d].filter(Boolean).join(' · ')
}

/** Products to offer in a picker: archived ones only if already chosen. */
export const pickable = (products: ProductU[], chosen?: string) => products.filter(p => !p.archived_at || p.id === chosen)

export const productLabel = (p: Pick<Product, 'name' | 'brand'>) => [p.brand, p.name].filter(Boolean).join(' ')
