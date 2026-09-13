// ─────────────────────────────────────────────────────────────────────────────
// Where on the car a service lives.
//
// The health map colours regions of a top-down car by the state of the services
// that touch them. Categories are free text, so the mapping is by name — which is
// safe here in a way it wasn't for tire fitting: a miss only means a category
// isn't lit up on the drawing. It still appears in the list, and nothing is
// written or triggered on the strength of a match.
//
// This is the one table to extend when new zones are added.
// ─────────────────────────────────────────────────────────────────────────────

export type ZoneId = 'tires' | 'brakes' | 'engine' | 'transmission' | 'battery' | 'cabin' | 'wipers'

export interface ZoneDef {
  id: ZoneId
  label: string
  /** Checked in order — the first match wins, so specific rules come first. */
  match: RegExp
  /** Shown on small screens, where only the big-ticket regions earn space. */
  compact: boolean
}

export const ZONES: ZoneDef[] = [
  { id: 'tires',        label: 'Tires & wheels', match: /\b(tires?|tyres?|wheels?|alignment|balanc\w*)\b/i, compact: true },
  { id: 'brakes',       label: 'Brakes',         match: /\bbrakes?\b/i,                                      compact: false },
  { id: 'transmission', label: 'Transmission',   match: /\b(cvt|transmission|atf|differential|diff)\b/i,     compact: false },
  { id: 'battery',      label: 'Battery',        match: /\bbatter(y|ies)\b/i,                                compact: false },
  // Before engine: "Cabin Air Filter" must not land on the engine's air filter.
  { id: 'cabin',        label: 'Cabin',          match: /\b(cabin|a\/?c|air conditioning|hvac)\b/i,          compact: false },
  { id: 'wipers',       label: 'Wipers & glass', match: /\b(wipers?|windshield|washer)\b/i,                  compact: false },
  { id: 'engine',       label: 'Engine',         match: /\b(oil|engine|spark|plugs?|coolant|antifreeze|radiator|belts?|air filter|pcv|throttle|valves?)\b/i, compact: true },
]

export function zoneFor(categoryName: string): ZoneId | null {
  for (const z of ZONES) if (z.match.test(categoryName)) return z.id
  return null
}

/** ok = nothing pressing · soon = coming up (yellow) · due = needs doing (red). */
export type ZoneLevel = 'ok' | 'soon' | 'due' | 'none'

export interface ZoneItem {
  id: string                 // category id, or a synthetic id for non-category sources
  name: string
  level: Exclude<ZoneLevel, 'none'>
  detail: string | null      // "300 mi left", "overdue by 1,200 mi"
}

export interface ZoneState {
  zone: ZoneDef
  level: ZoneLevel
  items: ZoneItem[]          // worst first
}

const RANK: Record<ZoneLevel, number> = { due: 3, soon: 2, ok: 1, none: 0 }

/**
 * Roll every item up to its zone. A zone takes the worst level among its items,
 * so one overdue job reddens the region even if three others are fine.
 */
export function zoneStates(items: (ZoneItem & { zone: ZoneId | null })[]): Map<ZoneId, ZoneState> {
  const out = new Map<ZoneId, ZoneState>()
  for (const z of ZONES) out.set(z.id, { zone: z, level: 'none', items: [] })
  for (const it of items) {
    if (!it.zone) continue
    const st = out.get(it.zone)!
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
