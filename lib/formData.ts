// Everything about the garage beyond the car's own services and fuel: products, stock
// lots (with each lot's receipt, so a part can say where it came from), categories,
// tires and shop bills. One loader serves the forms (fresh each time one opens) and
// the Stock and Services pages (through useGarage).
import { supabase } from '@/lib/supabase'
import { read } from '@/lib/recover'
import { computeStock, type ProductStock } from '@/lib/inventory'
import { allTireLives, tireProductChoices, type Tire, type TireEvent, type TireLife } from '@/lib/tires'
import type { ProductType } from '@/lib/productTypes'
import type { InventoryAdjustment, Product, ProductCategoryLink, ProductLink, Receipt, ReceiptItem, ServiceCategory, ServiceLog, ServiceProductUsage } from '@/lib/types'

export type ProductU = Product & { unit?: string }
export type LogRow = Pick<ServiceLog, 'id' | 'date' | 'service_type' | 'performed_by' | 'cost' | 'odometer'>

/** The rows as loaded, before stock is worked out. */
export interface GarageRows {
  products: ProductU[]
  categories: ServiceCategory[]
  links: ProductCategoryLink[]
  receipts: Receipt[]
  items: ReceiptItem[]
  usage: ServiceProductUsage[]
  adjustments: InventoryAdjustment[]
  logs: LogRow[]
  tires: Tire[]
  tireEvents: TireEvent[]
  types: ProductType[]
  productLinks: ProductLink[]
  billLinks: { log_id: string; receipt_id: string }[]
}

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
  logs: LogRow[]
}

export async function fetchGarageRows(userId: string, vehicleId: string): Promise<GarageRows> {
  const [prods, cats, links, rcpts, items, usage, adj, logs, tires, events, types, productLinks, billLinks] = await Promise.all([
    read(supabase.from('products').select('*').eq('user_id', userId).order('name')),
    read(supabase.from('service_categories').select('*').eq('vehicle_id', vehicleId).order('name')),
    read(supabase.from('product_category_links').select('*')),
    read(supabase.from('receipts').select('*').eq('user_id', userId)),
    read(supabase.from('receipt_items').select('*')),
    read(supabase.from('service_product_usage').select('*')),
    read(supabase.from('inventory_adjustments').select('*').eq('user_id', userId)),
    read(supabase.from('service_logs').select('id,date,service_type,performed_by,cost,odometer').eq('user_id', userId)),
    read(supabase.from('tires').select('*')),
    read(supabase.from('tire_events').select('*').eq('vehicle_id', vehicleId)),
    read(supabase.from('product_types').select('*').eq('user_id', userId).order('name')),
    read(supabase.from('product_links').select('*')),
    read(supabase.from('service_log_receipts').select('*')),
  ])
  // Products are the heart of it; the rest just shows less when missing.
  if (prods.error) throw new Error(prods.error.message)
  return {
    products: (prods.data ?? []) as ProductU[],
    categories: (cats.data ?? []) as ServiceCategory[],
    links: (links.data ?? []) as ProductCategoryLink[],
    receipts: (rcpts.data ?? []) as Receipt[],
    items: (items.data ?? []) as ReceiptItem[],
    usage: (usage.data ?? []) as ServiceProductUsage[],
    adjustments: (adj.data ?? []) as InventoryAdjustment[],
    logs: (logs.data ?? []) as LogRow[],
    tires: (tires.data ?? []) as Tire[],
    tireEvents: (events.data ?? []) as TireEvent[],
    types: (types.data ?? []) as ProductType[],
    productLinks: (productLinks.data ?? []) as ProductLink[],
    billLinks: (billLinks.data ?? []) as GarageRows['billLinks'],
  }
}

export function buildGarage(rows: GarageRows, currentOdo: number, excludeLogId?: string): GarageContext {
  const { products, categories, links } = rows
  const dates = Object.fromEntries(rows.logs.map(l => [l.id, l.date]))
  const stock = computeStock(products, rows.receipts, rows.items, rows.usage.filter(u => u.log_id !== excludeLogId),
    rows.adjustments, id => dates[id] ?? null)
  // A tire product is one typed or named as a tire, or one "used for" a tire category.
  const tireCats = new Set(categories.filter(c => c.tracks_tires).map(c => c.id))
  const byType = tireProductChoices(products, rows.types)
  const byLink = products.filter(p => links.some(l => l.product_id === p.id && tireCats.has(l.category_id)) && !byType.some(t => t.id === p.id))
    .map(p => ({ id: p.id, name: [p.brand, p.name].filter(Boolean).join(' ') }))
  return {
    products, categories, links,
    receipts: new Map(rows.receipts.map(r => [r.id, r])), items: rows.items, usage: rows.usage, stock,
    tireLives: allTireLives(rows.tires, rows.tireEvents, currentOdo),
    tireProducts: [...byType, ...byLink],
    logs: rows.logs,
  }
}

/** Fresh rows and stock in one go, for a form that just opened. */
export async function loadGarage(userId: string, vehicleId: string, currentOdo: number, excludeLogId?: string): Promise<GarageContext> {
  return buildGarage(await fetchGarageRows(userId, vehicleId), currentOdo, excludeLogId)
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
