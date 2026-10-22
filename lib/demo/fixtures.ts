// ─────────────────────────────────────────────────────────────────────────────
// Demo data for NEXT_PUBLIC_DEMO=1 (dev only: screenshots and trying flows
// without touching the real database). Deterministic, ~2 years of one car,
// shaped so every chart and comparison has something to show: seasonal driving,
// two road trips, DIY and shop work, receipts, stock, tires.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

const UID = 'demo-user'
const VID = 'demo-car'
const DAY = 86_400_000

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const id = (p: string, n: number) => `${p}-${String(n).padStart(4, '0')}`

export function buildDemoData(): Record<string, Row[]> {
  const r = rng(20261022)
  const today = Date.UTC(2026, 9, 21)
  const start = Date.UTC(2024, 8, 2)

  // ── Fuel: a fill-up every 5–9 days; miles follow the season, plus two trips ──
  const fuel: Row[] = []
  const timeline: { t: number; odo: number }[] = []
  let t = start, odo = 96_480, n = 0
  timeline.push({ t, odo })
  while (t < today - 2 * DAY) {
    const gap = 5 + Math.floor(r() * 5)
    t += gap * DAY
    const d = new Date(t)
    const m = d.getUTCMonth()
    const season = [0.82, 0.84, 0.95, 1.0, 1.06, 1.14, 1.2, 1.18, 1.05, 1.0, 0.92, 0.86][m]
    let daily = 38 * season * (0.8 + r() * 0.4)
    const trip = (d >= new Date(Date.UTC(2025, 6, 3)) && d <= new Date(Date.UTC(2025, 6, 12)))
      || (d >= new Date(Date.UTC(2026, 7, 14)) && d <= new Date(Date.UTC(2026, 7, 22)))
    if (trip) daily *= 2.6
    const miles = Math.round(daily * gap)
    odo += miles
    timeline.push({ t, odo })
    const mpgBase = 34 + [-3, -3, -1.5, 0, 1, 1.5, 1.5, 1.5, 1, 0, -1.5, -2.5][m] + (trip ? 3 : 0)
    const mpg = mpgBase + (r() - 0.5) * 4
    const gallons = +(miles / mpg).toFixed(3)
    const ppg = +(3.35 + 0.35 * Math.sin((t - start) / (365 * DAY) * 2 * Math.PI + 1.2) + (t - start) / (730 * DAY) * 0.35 + (r() - 0.5) * 0.2).toFixed(3)
    fuel.push({
      id: id('fuel', ++n), user_id: UID, vehicle_id: VID, date: iso(t), odometer: odo,
      gallons, price_per_gallon: ppg, total_cost: +(gallons * ppg).toFixed(2),
      mpg: n === 1 ? null : +(miles / gallons).toFixed(2), created_at: new Date(t).toISOString(),
    })
  }
  const odoAt = (when: number) => {
    for (let i = 1; i < timeline.length; i++) {
      const a = timeline[i - 1], b = timeline[i]
      if (when <= b.t) return Math.round(a.odo + (b.odo - a.odo) * ((when - a.t) / (b.t - a.t)))
    }
    return timeline[timeline.length - 1].odo
  }
  const finalOdo = timeline[timeline.length - 1].odo

  // ── Categories ──
  const catDefs: [string, number | null, number | null, string, boolean?][] = [
    ['Oil Change', 5000, 180, 'engine'], ['Tire Rotation', 5000, 180, 'tires'], ['Brake Inspection', 20000, 730, 'brakes'],
    ['Cabin Filter', 15000, 540, 'cabin'], ['Air Filter', 20000, 730, 'engine'], ['CVT Fluid', 30000, 1095, 'transmission'],
    ['Spark Plugs', 60000, 2190, 'engine'], ['Tire Replacement', null, null, 'tires', true], ['Wiper Blades', 12000, 365, 'body'],
  ]
  const service_categories: Row[] = catDefs.map(([name, mi, days, comp, tires], i) => ({
    id: id('cat', i + 1), user_id: UID, vehicle_id: VID, name, category_type: 'maintenance', sub_type: null,
    interval_miles: mi, interval_days: days, global_category_id: id('gcat', i + 1), is_visible: true,
    tracks_tires: Boolean(tires), component: comp, created_at: '2024-09-01T00:00:00Z',
  }))
  const catId = (name: string) => service_categories.find(c => c.name === name)!.id as string

  // ── Products, receipts, stock ──
  const prodDefs: [string, string, string, string?][] = [
    ['Ultra Platinum 0W-20', 'Pennzoil', 'qt', 'Oil Change'], ['Oil filter PH7317', 'Fram', 'each', 'Oil Change'],
    ['Drain plug gasket', 'Needa', 'each', 'Oil Change'], ['Cabin air filter', 'Kirkland', 'each', 'Cabin Filter'],
    ['Engine air filter', 'Fram', 'each', 'Air Filter'], ['Brake parts cleaner 14oz', 'ShopPro', 'can'],
    ['Wiper fluid', 'Rain-X', 'gal'], ['CrossClimate2 215/55R16', 'Michelin', 'each', 'Tire Replacement'],
    ['Wiper blades 26"', 'Bosch', 'each', 'Wiper Blades'],
  ]
  const products: Row[] = prodDefs.map(([name, brand, unit], i) => ({
    id: id('prod', i + 1), user_id: UID, vehicle_id: null, name, brand, unit, notes: null,
    product_type_id: null, tire_directional: name.startsWith('CrossClimate') ? true : null, created_at: '2024-09-01T00:00:00Z',
  }))
  const pid = (name: string) => products.find(p => p.name === name)!.id as string
  const product_category_links: Row[] = prodDefs.filter(p => p[3]).map(p => ({ product_id: pid(p[0]), category_id: catId(p[3]!) }))

  const receipts: Row[] = [], receipt_items: Row[] = [], service_logs: Row[] = [], service_product_usage: Row[] = []
  const service_log_receipts: Row[] = []
  let rn = 0, rin = 0, sn = 0, un = 0
  const receipt = (date: string, store: string, items: [string, number, number][], noProducts = false) => {
    const rid = id('rcpt', ++rn)
    receipts.push({ id: rid, user_id: UID, date, store, image_path: null, total_cost: null, note: null, no_products: noProducts, created_at: date + 'T12:00:00Z' })
    const ids: string[] = []
    for (const [name, qty, cost] of items) {
      const iid = id('ritem', ++rin); ids.push(iid)
      receipt_items.push({ id: iid, receipt_id: rid, product_id: pid(name), qty, unit_cost: cost, created_at: date + 'T12:00:00Z' })
    }
    return { rid, ids }
  }
  const service = (when: number, name: string, by: 'owner' | 'shop', extra: Row = {}) => {
    const sid = id('svc', ++sn)
    service_logs.push({
      id: sid, user_id: UID, vehicle_id: VID, service_type: name, category_id: catId(name), record_type: 'maintenance',
      performed_by: by, shop_name: by === 'shop' ? 'Honda of Bay Ridge' : null, shop_location: by === 'shop' ? 'Brooklyn, NY' : null,
      receipt_url: null, session_id: null, date: iso(when), odometer: odoAt(when), cost: null, labor_cost: null,
      shop_equivalent_cost: null, notes: null, created_at: iso(when) + 'T18:00:00Z', ...extra,
    })
    return sid
  }
  const use = (sid: string, name: string, itemId: string | null, qty: number, cost: number | null) => {
    service_product_usage.push({ id: id('use', ++un), log_id: sid, product_id: pid(name), receipt_item_id: itemId, qty, unit_cost: cost, created_at: '2025-01-01T00:00:00Z' })
  }

  // Oil changes every ~5,000 mi: shop at first, DIY from spring 2025 with stocked parts.
  const oilDays: number[] = []
  let next = 98_900
  for (const p of timeline) if (p.odo >= next) { oilDays.push(p.t + DAY); next = p.odo + 4700 + Math.round(r() * 600) }
  oilDays.forEach((when, i) => {
    if (when > today) return
    if (i < 2) {
      const sid = service(when, 'Oil Change', 'shop', { cost: 79.99, notes: 'Synthetic 0W-20, filter, multipoint inspection.' })
      const bill = receipt(iso(when), 'Honda of Bay Ridge', [], true)
      service_log_receipts.push({ log_id: sid, receipt_id: bill.rid })
      return
    }
    const buy = receipt(iso(when - (5 + Math.floor(r() * 40)) * DAY), r() > 0.5 ? 'AutoZone' : 'Costco',
      [['Ultra Platinum 0W-20', 5, 9.198], ['Oil filter PH7317', 1, 9.99], ['Drain plug gasket', 1, 4.59]])
    const sid = service(when, 'Oil Change', 'owner', { cost: +(4.4 * 9.198 + 9.99 + 4.59).toFixed(2), shop_equivalent_cost: 75 })
    use(sid, 'Ultra Platinum 0W-20', buy.ids[0], 4.4, 9.198)
    use(sid, 'Oil filter PH7317', buy.ids[1], 1, 9.99)
    use(sid, 'Drain plug gasket', buy.ids[2], 1, 4.59)
  })
  // Tire rotations alongside every other oil change, DIY.
  oilDays.forEach((when, i) => { if (i % 2 === 1 && when + 3 * DAY < today) service(when + 3 * DAY, 'Tire Rotation', 'owner', { cost: 0, shop_equivalent_cost: 30 }) })
  // Shop work.
  const brake1 = Date.UTC(2025, 2, 18), brake2 = Date.UTC(2026, 9, 6)
  for (const [when, cost] of [[brake1, 49.99], [brake2, 49.99]] as const) {
    const sid = service(when, 'Brake Inspection', 'shop', { cost, notes: 'Pads at 6 mm front, 5 mm rear.' })
    const bill = receipt(iso(when), 'Honda of Bay Ridge', [], true)
    service_log_receipts.push({ log_id: sid, receipt_id: bill.rid })
  }
  { const when = Date.UTC(2025, 9, 11); const sid = service(when, 'CVT Fluid', 'shop', { cost: 189.5, notes: 'Honda HCF-2 drain and fill.' }); const b = receipt(iso(when), 'Honda of Bay Ridge', [], true); service_log_receipts.push({ log_id: sid, receipt_id: b.rid }) }
  // Filters, DIY.
  { const buy = receipt('2025-04-30', 'Costco', [['Cabin air filter', 2, 12.49], ['Engine air filter', 1, 18.99]])
    const s1 = service(Date.UTC(2025, 4, 3), 'Cabin Filter', 'owner', { cost: 12.49, shop_equivalent_cost: 60 }); use(s1, 'Cabin air filter', buy.ids[0], 1, 12.49)
    const s2 = service(Date.UTC(2025, 4, 3), 'Air Filter', 'owner', { cost: 18.99, shop_equivalent_cost: 55 }); use(s2, 'Engine air filter', buy.ids[1], 1, 18.99)
    const s3 = service(Date.UTC(2026, 8, 21), 'Cabin Filter', 'owner', { cost: 12.49, shop_equivalent_cost: 60 }); use(s3, 'Cabin air filter', buy.ids[0], 1, 12.49) }
  // Wipers.
  { const buy = receipt('2025-11-08', 'AutoZone', [['Wiper blades 26"', 2, 21.99], ['Brake parts cleaner 14oz', 2, 4.99]])
    const s = service(Date.UTC(2025, 10, 8), 'Wiper Blades', 'owner', { cost: 43.98, shop_equivalent_cost: 70 }); use(s, 'Wiper blades 26"', buy.ids[0], 2, 21.99) }
  // Tires: a set of four, fitted at a shop.
  const tireBuy = receipt('2025-04-11', 'Costco Tire Center', [['CrossClimate2 215/55R16', 4, 168.99]])
  const tireWhen = Date.UTC(2025, 3, 12)
  const tireSvc = service(tireWhen, 'Tire Replacement', 'shop', { cost: 4 * 168.99 + 96, notes: 'Mount, balance, TPMS kits.' })
  const tires: Row[] = [], tire_events: Row[] = []
  ;(['FL', 'FR', 'RL', 'RR'] as const).forEach((pos, i) => {
    const tid = id('tire', i + 1)
    tires.push({ id: tid, user_id: UID, product_id: pid('CrossClimate2 215/55R16'), receipt_item_id: tireBuy.ids[0], label: null, expected_life_miles: 60000, purchased_date: '2025-04-11', retired_date: null, retired_reason: null, created_at: '2025-04-12T00:00:00Z' })
    tire_events.push({ id: id('tev', i + 1), user_id: UID, vehicle_id: VID, tire_id: tid, log_id: tireSvc, position: pos, odometer: odoAt(tireWhen), date: iso(tireWhen), created_at: '2025-04-12T00:00:00Z' })
    use(tireSvc, 'CrossClimate2 215/55R16', tireBuy.ids[0], 1, 168.99)
  })

  const inventory_adjustments: Row[] = [
    { id: 'adj-0001', user_id: UID, product_id: pid('Wiper fluid'), qty_delta: 1.5, unit_cost: null, note: 'Already had it (old inventory)', date: '2026-09-01', created_at: '2026-09-01T00:00:00Z' },
  ]

  service_logs.sort((a, b) => String(b.date).localeCompare(String(a.date)))

  const global_categories: Row[] = catDefs.map(([name, mi, days], i) => ({ id: id('gcat', i + 1), name, category_type: 'maintenance', interval_miles: mi, interval_days: days, is_active: true, created_by: UID, created_at: '2024-08-01T00:00:00Z' }))
  global_categories.push({ id: 'gcat-0100', name: 'Coolant', category_type: 'maintenance', interval_miles: 100000, interval_days: 3650, is_active: true, created_by: UID, created_at: '2026-10-01T00:00:00Z' })

  return {
    vehicles: [{ id: VID, user_id: UID, make: 'Honda', model: 'Civic', year: 2016, trim: 'EX', odometer: finalOdo, vin: null, license_plate: null, details_confirmed: true, track_tire_positions: true, created_at: '2024-09-01T00:00:00Z' }],
    fuel_logs: fuel.reverse(),
    service_categories, service_logs, products, product_category_links, receipts, receipt_items, service_product_usage,
    service_log_receipts, inventory_adjustments, tires, tire_events, global_categories,
    product_links: [{ id: 'plink-1', product_id: pid('Ultra Platinum 0W-20'), label: 'Buy', url: 'https://www.autozone.com' }],
    product_types: [], product_type_category_links: [], service_category_products: [],
    user_profiles: [
      { id: UID, email: 'demo@vgarage.local', full_name: 'Demo Driver', role: 'admin', created_at: '2024-08-01T00:00:00Z' },
      { id: 'demo-friend', email: 'friend@example.com', full_name: 'Het', role: 'user', created_at: '2026-10-15T00:00:00Z' },
    ],
    category_requests: [{ id: 'creq-1', user_id: 'demo-friend', vehicle_id: null, name: 'Timing belt', description: 'Mine has a belt, not a chain.', interval_miles: 100000, interval_days: 3650, status: 'pending', admin_notes: null, created_at: '2026-10-18T00:00:00Z' }],
  }
}

export const DEMO_USER = { id: UID, email: 'demo@vgarage.local' }
