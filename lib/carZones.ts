// ─────────────────────────────────────────────────────────────────────────────
// Major components of the car.
//
// Every service category belongs to one, chosen when the category is created
// (service_categories.component). The health map lights each component by the
// state of its services, and the list groups by it.
//
// The name is only used to SUGGEST a component — for categories created before
// the field existed, and as the default in the picker. Whatever the user picks
// wins. The full set is defined up front, so a service added later always has a
// home, including parts nothing is logged against yet.
// ─────────────────────────────────────────────────────────────────────────────

export type ZoneId =
  | 'engine' | 'intake' | 'transmission' | 'brakes' | 'tires' | 'suspension'
  | 'exhaust' | 'fuel' | 'battery' | 'cabin' | 'wipers' | 'body' | 'general'

export interface ZoneDef {
  id: ZoneId
  label: string
  /** One line for the picker, so the choice is obvious. */
  hint: string
  /** Has a part on the drawing. General work lives in the list only. */
  drawn: boolean
  /** Shown on small screens, where only the big-ticket parts earn space. */
  compact: boolean
}

export const ZONES: ZoneDef[] = [
  { id: 'engine',       label: 'Engine & cooling',      hint: 'Oil, spark plugs, belts, coolant, radiator',       drawn: true,  compact: true },
  { id: 'intake',       label: 'Air intake',            hint: 'Engine air filter, throttle body',                 drawn: true,  compact: false },
  { id: 'transmission', label: 'Transmission',          hint: 'CVT / ATF fluid, axles, differential',             drawn: true,  compact: false },
  { id: 'brakes',       label: 'Brakes',                hint: 'Pads, rotors, calipers, brake fluid',              drawn: true,  compact: false },
  { id: 'tires',        label: 'Tires & wheels',        hint: 'Rotation, balance, alignment, tire life',          drawn: true,  compact: true },
  { id: 'suspension',   label: 'Suspension & steering', hint: 'Struts, shocks, springs, steering, tie rods',      drawn: true,  compact: false },
  { id: 'exhaust',      label: 'Exhaust',               hint: 'Catalytic converter, muffler, O2 sensors',         drawn: true,  compact: false },
  { id: 'fuel',         label: 'Fuel system',           hint: 'Fuel tank, filter, pump, EVAP',                    drawn: true,  compact: false },
  { id: 'battery',      label: 'Battery & electrical',  hint: 'Battery, alternator, starter, fuses',              drawn: true,  compact: false },
  { id: 'cabin',        label: 'Cabin & HVAC',          hint: 'Cabin air filter, A/C, heater',                    drawn: true,  compact: false },
  { id: 'wipers',       label: 'Wipers & glass',        hint: 'Wiper blades, washer fluid, windshield',           drawn: true,  compact: false },
  { id: 'body',         label: 'Body & lights',         hint: 'Bulbs, headlights, paint, washing, detailing',     drawn: true,  compact: false },
  { id: 'general',      label: 'General',               hint: 'Inspections and work on the car as a whole',       drawn: false, compact: false },
]

export const zoneById = (id: ZoneId): ZoneDef => ZONES.find(z => z.id === id)!

export const isZoneId = (v: unknown): v is ZoneId =>
  typeof v === 'string' && ZONES.some(z => z.id === v)

// Checked in order, so specific rules come first: "Brake Light" is a bulb, not
// the brakes; "Cabin Air Filter" is the cabin, not the engine's air filter;
// "Fuel Filter" is the fuel system.
const SUGGEST: [RegExp, ZoneId][] = [
  [/\b(bulbs?|head ?lights?|tail ?lights?|fog ?lights?|brake ?lights?)\b/i, 'body'],
  [/\b(tires?|tyres?|wheels?|alignment|balanc\w*|tpms)\b/i, 'tires'],
  [/\bbrakes?\b/i, 'brakes'],
  [/\b(struts?|shocks?|springs?|suspension|steering|tie ?rods?|control arms?|sway|bushings?|ball joints?)\b/i, 'suspension'],
  [/\b(cvt|transmission|atf|differential|diff|axles?|cv joints?|clutch)\b/i, 'transmission'],
  [/\b(exhaust|muffler|catalytic|o2|oxygen sensors?)\b/i, 'exhaust'],
  [/\b(fuel|gas cap|evap)\b/i, 'fuel'],
  [/\b(batter(y|ies)|alternator|starter|fuses?|electrical)\b/i, 'battery'],
  [/\b(cabin|a\/?c|air conditioning|hvac|heater)\b/i, 'cabin'],
  [/\b(air filter|intake|throttle|maf)\b/i, 'intake'],
  [/\b(wipers?|windshield|washer)\b/i, 'wipers'],
  [/\b(paint|detail\w*|wash|wax|body|bumper|dent)\b/i, 'body'],
  [/\b(oil|engine|spark|plugs?|coolant|antifreeze|radiator|belts?|pcv|valves?|thermostat|water pump|hoses?)\b/i, 'engine'],
]

/** Best guess from a name, or null when nothing fits. */
export function zoneFor(categoryName: string): ZoneId | null {
  for (const [re, id] of SUGGEST) if (re.test(categoryName)) return id
  return null
}

/** The component a category belongs to: what the user chose, else a suggestion. */
export function componentOf(cat: { name: string; component?: string | null }): ZoneId {
  if (isZoneId(cat.component)) return cat.component
  return zoneFor(cat.name) ?? 'general'
}

/** ok = nothing pressing · soon = coming up (yellow) · due = needs doing (red). */
export type ZoneLevel = 'ok' | 'soon' | 'due' | 'none'

export interface ZoneItem {
  id: string
  name: string
  level: Exclude<ZoneLevel, 'none'>
  detail: string | null
}

export interface ZoneState {
  zone: ZoneDef
  level: ZoneLevel
  items: ZoneItem[]          // worst first
}

const RANK: Record<ZoneLevel, number> = { due: 3, soon: 2, ok: 1, none: 0 }

/**
 * Roll every item up to its component. A component takes the worst level among
 * its items, so one overdue job reddens the part even if three others are fine.
 */
export function zoneStates(items: (ZoneItem & { zone: ZoneId | null })[]): Map<ZoneId, ZoneState> {
  const out = new Map<ZoneId, ZoneState>()
  for (const z of ZONES) out.set(z.id, { zone: z, level: 'none', items: [] })
  for (const it of items) {
    const st = out.get(it.zone ?? 'general')!
    st.items.push({ id: it.id, name: it.name, level: it.level, detail: it.detail })
    if (RANK[it.level] > RANK[st.level]) st.level = it.level
  }
  for (const st of out.values()) st.items.sort((a, b) => RANK[b.level] - RANK[a.level])
  return out
}

export const LEVEL_COLOR: Record<ZoneLevel, string> = {
  due: '#ef4444',
  soon: '#f59e0b',
  ok: '#22c55e',
  none: '#3b82f6',
}

export const LEVEL_LABEL: Record<ZoneLevel, string> = {
  due: 'Needs attention',
  soon: 'Coming up',
  ok: 'All good',
  none: 'Not tracked',
}
