// The admin catalog is a template, not a one-time copy. A car starts with a copy of
// it; later catalog entries and interval changes are offered, never pushed.
import { supabase } from '@/lib/supabase'
import { read, step } from '@/lib/recover'
import { componentOf } from '@/lib/carZones'
import type { GlobalCategory, ServiceCategory } from '@/lib/types'

// Used only when the catalog itself is empty, so a new car still has a schedule.
const DEFAULTS: { name: string; interval_miles: number; interval_days: number }[] = [
  { name: 'Oil Change', interval_miles: 5000, interval_days: 180 },
  { name: 'CVT Fluid', interval_miles: 30000, interval_days: 1095 },
  { name: 'Spark Plugs', interval_miles: 60000, interval_days: 2190 },
  { name: 'Tire Rotation', interval_miles: 5000, interval_days: 180 },
  { name: 'Brake Inspection', interval_miles: 20000, interval_days: 730 },
  { name: 'Air Filter', interval_miles: 20000, interval_days: 730 },
  { name: 'Cabin Filter', interval_miles: 15000, interval_days: 540 },
]

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

type Mine = Pick<ServiceCategory, 'name' | 'global_category_id'>

/** Active catalog entries this car doesn't have yet (matched by link, then by name). */
export function missingFromCatalog(catalog: GlobalCategory[], mine: Mine[]): GlobalCategory[] {
  return catalog.filter(g => g.is_active && !mine.some(c => c.global_category_id === g.id || sameName(c.name, g.name)))
}

export interface IntervalOffer { cat: ServiceCategory; entry: GlobalCategory }

/** The car's catalog categories whose intervals no longer match the catalog. */
export function intervalOffers(catalog: GlobalCategory[], mine: ServiceCategory[]): IntervalOffer[] {
  const offers: IntervalOffer[] = []
  for (const cat of mine) {
    const entry = catalog.find(g => g.id === cat.global_category_id)
    if (!entry || !entry.is_active) continue
    if (entry.interval_miles !== cat.interval_miles || entry.interval_days !== cat.interval_days) offers.push({ cat, entry })
  }
  return offers
}

/** "Every 5,000 mi or 180 days", or null without a schedule. */
export function intervalText(c: { interval_miles: number | null; interval_days: number | null }): string | null {
  const parts = [
    c.interval_miles ? `${c.interval_miles.toLocaleString()} mi` : null,
    c.interval_days ? `${c.interval_days.toLocaleString()} days` : null,
  ].filter(Boolean)
  return parts.length ? `Every ${parts.join(' or ')}` : null
}

export async function addFromCatalog(entries: GlobalCategory[], userId: string, vehicleId: string): Promise<void> {
  if (!entries.length) return
  await step(() => supabase.from('service_categories').insert(entries.map(g => ({
    user_id: userId,
    vehicle_id: vehicleId,
    name: g.name,
    category_type: g.category_type,
    interval_miles: g.interval_miles,
    interval_days: g.interval_days,
    component: componentOf({ name: g.name }),
    global_category_id: g.id,
    is_visible: true,
  }))))
}

/**
 * Give a car every catalog category it doesn't have. Safe to repeat: a retry after a
 * failure only adds what's still missing. Returns how many categories the car now has.
 */
export async function seedCar(userId: string, vehicleId: string): Promise<number> {
  const [{ data: catalog, error: catalogError }, { data: existing, error: existingError }] = await Promise.all([
    read(supabase.from('global_categories').select('*').order('name')),
    read(supabase.from('service_categories').select('name,global_category_id').eq('vehicle_id', vehicleId)),
  ])
  if (catalogError || existingError) throw new Error((catalogError ?? existingError)!.message)
  const mine = (existing ?? []) as Mine[]
  const entries = (catalog ?? []) as GlobalCategory[]
  if (entries.length) {
    const missing = missingFromCatalog(entries, mine)
    await addFromCatalog(missing, userId, vehicleId)
    return mine.length + missing.length
  }
  const missing = DEFAULTS.filter(d => !mine.some(c => sameName(c.name, d.name)))
  if (missing.length) {
    await step(() => supabase.from('service_categories').insert(missing.map(d => ({
      user_id: userId,
      vehicle_id: vehicleId,
      category_type: 'maintenance',
      component: componentOf({ name: d.name }),
      is_visible: true,
      ...d,
    }))))
  }
  return mine.length + missing.length
}

/** Put two same-named categories together: history moves to `primary` before `dup` goes. */
export async function mergeCategory(dup: ServiceCategory, primary: ServiceCategory): Promise<void> {
  await step(() => supabase.from('service_logs').update({ category_id: primary.id }).eq('category_id', dup.id))
  await step(() => supabase.from('service_category_products').update({ category_id: primary.id }).eq('category_id', dup.id))
  const [{ data: dupLinks }, { data: primaryLinks }] = await Promise.all([
    read(supabase.from('product_category_links').select('product_id').eq('category_id', dup.id)),
    read(supabase.from('product_category_links').select('product_id').eq('category_id', primary.id)),
  ])
  const have = new Set((primaryLinks ?? []).map(l => l.product_id as string))
  const move = (dupLinks ?? []).filter(l => !have.has(l.product_id as string))
  if (move.length) await step(() => supabase.from('product_category_links').insert(move.map(l => ({ product_id: l.product_id, category_id: primary.id }))))
  await step(() => supabase.from('service_categories').delete().eq('id', dup.id))
}
