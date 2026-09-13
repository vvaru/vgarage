import { differenceInCalendarDays, parseISO } from 'date-fns'

// ─────────────────────────────────────────────────────────────────────────────
// Tires, tracked as individuals.
//
// A tire isn't fungible like oil and isn't consumed on use: it comes off, sits
// in the garage, and goes back on next season carrying its history. So mileage
// accrues ONLY across the stretches a tire was actually mounted — which makes
// seasonal swapping, rotation, and one odd replacement the same mechanism
// rather than three special cases.
// ─────────────────────────────────────────────────────────────────────────────

export const TIRE_POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const
export type TirePosition = (typeof TIRE_POSITIONS)[number]

export const POSITION_LABELS: Record<TirePosition, string> = {
  FL: 'Front left', FR: 'Front right', RL: 'Rear left', RR: 'Rear right',
}
export const POSITION_SHORT: Record<TirePosition, string> = {
  FL: 'FL', FR: 'FR', RL: 'RL', RR: 'RR',
}
export const AXLES: { label: string; positions: [TirePosition, TirePosition] }[] = [
  { label: 'Front', positions: ['FL', 'FR'] },
  { label: 'Rear', positions: ['RL', 'RR'] },
]

export interface Tire {
  id: string
  user_id: string
  product_id: string | null
  receipt_item_id: string | null
  label: string | null
  expected_life_miles: number | null
  purchased_date: string | null
  retired_date: string | null
  retired_reason: string | null
}

/** position null = taken off and stored. */
export interface TireEvent {
  id: string
  tire_id: string
  vehicle_id: string
  log_id: string | null
  position: TirePosition | null
  odometer: number
  date: string
}

export type TireStatus = 'good' | 'worn' | 'due' | 'over' | 'unknown'

/** Share of expected life used before a tire stops being simply "good". */
export const WEAR_BANDS = { worn: 0.7, due: 0.9 }

/**
 * Two tires on the same axle differing by more than this is worth flagging —
 * it's a handling concern, not just uneven wear. Used when neither tire records
 * an expected life; otherwise the threshold is a share of that life.
 */
export const AXLE_MISMATCH_MILES = 5_000
export const AXLE_MISMATCH_SHARE = 0.2

export interface TireLife {
  tire: Tire
  miles: number                 // accrued only while mounted
  position: TirePosition | null // where it is now; null = in storage
  mounted: boolean
  retired: boolean
  expected: number | null
  remaining: number | null
  pctUsed: number | null
  status: TireStatus
  fittedOdometer: number | null // when it most recently went on
  fittedDate: string | null
  daysOwned: number | null
}

const byOdo = (a: TireEvent, b: TireEvent) =>
  a.odometer - b.odometer || a.date.localeCompare(b.date)

/**
 * Miles a tire has actually turned: the sum of every stretch between going on
 * and coming off. A rotation is mounted→mounted, so it accrues straight through;
 * winter storage is mounted→null, so it pauses until the next fitting.
 */
export function tireMiles(events: TireEvent[], currentOdometer: number): number {
  const sorted = [...events].sort(byOdo)
  let miles = 0
  for (let i = 0; i < sorted.length; i++) {
    if (!sorted[i].position) continue           // stored from here until the next event
    const next = sorted[i + 1]
    const end = next ? next.odometer : currentOdometer
    miles += Math.max(0, end - sorted[i].odometer)
  }
  return miles
}

function statusFor(pctUsed: number | null): TireStatus {
  if (pctUsed == null) return 'unknown'
  if (pctUsed >= 100) return 'over'
  if (pctUsed >= WEAR_BANDS.due * 100) return 'due'
  if (pctUsed >= WEAR_BANDS.worn * 100) return 'worn'
  return 'good'
}

export function tireLife(
  tire: Tire,
  events: TireEvent[],
  currentOdometer: number,
  now = new Date(),
): TireLife {
  const mine = events.filter(e => e.tire_id === tire.id).sort(byOdo)
  const last = mine[mine.length - 1] ?? null
  const miles = tireMiles(mine, currentOdometer)
  const expected = tire.expected_life_miles && tire.expected_life_miles > 0 ? tire.expected_life_miles : null
  const pctUsed = expected ? (miles / expected) * 100 : null

  const fitted = last?.position ? last : null
  let daysOwned: number | null = null
  if (tire.purchased_date) {
    try { daysOwned = Math.max(0, differenceInCalendarDays(now, parseISO(tire.purchased_date))) } catch { /* bad date */ }
  }

  return {
    tire,
    miles,
    position: last?.position ?? null,
    mounted: Boolean(last?.position) && !tire.retired_date,
    retired: Boolean(tire.retired_date),
    expected,
    remaining: expected ? expected - miles : null,
    pctUsed,
    status: statusFor(pctUsed),
    fittedOdometer: fitted?.odometer ?? null,
    fittedDate: fitted?.date ?? null,
    daysOwned,
  }
}

export function allTireLives(tires: Tire[], events: TireEvent[], currentOdometer: number, now = new Date()): TireLife[] {
  return tires.map(t => tireLife(t, events, currentOdometer, now))
}

/** What's on the car right now, by corner. */
export function mountedByPosition(lives: TireLife[]): Map<TirePosition, TireLife> {
  const out = new Map<TirePosition, TireLife>()
  for (const l of lives) {
    if (l.mounted && l.position) out.set(l.position, l)
  }
  return out
}

export interface AxleWarning {
  axle: string
  positions: [TirePosition, TirePosition]
  differenceMiles: number
}

/**
 * Two tires on one axle wearing very differently is a handling concern, so it's
 * worth saying. A front-vs-rear difference is normal and deliberately ignored.
 */
export function axleWarnings(lives: TireLife[]): AxleWarning[] {
  const mounted = mountedByPosition(lives)
  const out: AxleWarning[] = []
  for (const axle of AXLES) {
    const a = mounted.get(axle.positions[0])
    const b = mounted.get(axle.positions[1])
    if (!a || !b) continue
    const diff = Math.abs(a.miles - b.miles)
    const expectations = [a.expected, b.expected].filter((v): v is number => v != null)
    const threshold = expectations.length
      ? (expectations.reduce((s, v) => s + v, 0) / expectations.length) * AXLE_MISMATCH_SHARE
      : AXLE_MISMATCH_MILES
    if (diff > threshold) {
      out.push({ axle: axle.label, positions: axle.positions, differenceMiles: Math.round(diff) })
    }
  }
  return out
}

/** Headline for the summary card: the worst corner currently on the car. */
export function worstMounted(lives: TireLife[]): TireLife | null {
  const rank: Record<TireStatus, number> = { over: 4, due: 3, worn: 2, good: 1, unknown: 0 }
  const mounted = lives.filter(l => l.mounted)
  if (mounted.length === 0) return null
  return [...mounted].sort((a, b) => rank[b.status] - rank[a.status] || (b.pctUsed ?? -1) - (a.pctUsed ?? -1))[0]
}

export interface SetHealth {
  pctLeft: number | null
  status: TireStatus | 'empty'
  mounted: number
  spare: number
}

export function setHealth(lives: TireLife[]): SetHealth {
  const mounted = lives.filter(l => l.mounted)
  const spare = lives.filter(l => !l.mounted && !l.retired).length
  if (mounted.length === 0) return { pctLeft: null, status: 'empty', mounted: 0, spare }
  const withPct = mounted.filter(l => l.pctUsed != null)
  if (withPct.length === 0) return { pctLeft: null, status: 'unknown', mounted: mounted.length, spare }
  const worstUsed = Math.max(...withPct.map(l => l.pctUsed as number))
  return { pctLeft: Math.max(0, 100 - worstUsed), status: statusFor(worstUsed), mounted: mounted.length, spare }
}

/** A tire's display name: its label, else the model it's an instance of. */
export const tireName = (life: TireLife, productName: (id: string) => string): string =>
  life.tire.label?.trim()
    || (life.tire.product_id ? productName(life.tire.product_id) : '')
    || 'Tire'

// ── Rotation ────────────────────────────────────────────────────────────────
//
// Which patterns are legal is decided by the TIRE, not the car. A directional
// tire's tread is cut to turn one way, so it can only move front<->back on its
// own side; crossing it over would run the tread backwards. A non-directional
// tire can go anywhere.
//
// (A car can impose its own limit — staggered fitment, wider rears — which
// blocks front<->back instead. Different constraint, different place; this car
// runs one size all round.)

export interface RotationPattern {
  key: string
  label: string
  description: string
  /** from corner → to corner */
  moves: Record<TirePosition, TirePosition>
  /** Crossing patterns run a directional tread backwards on one side. */
  crosses: boolean
}

export const ROTATION_PATTERNS: RotationPattern[] = [
  {
    key: 'front-back',
    label: 'Front to back',
    description: 'Each tire swaps with the one at the other end of its own side.',
    moves: { FL: 'RL', RL: 'FL', FR: 'RR', RR: 'FR' },
    crosses: false,
  },
  {
    key: 'forward-cross',
    label: 'Forward cross',
    description: 'Rears cross to the front, fronts drop straight back. Usual choice for front-wheel drive.',
    moves: { RL: 'FR', RR: 'FL', FL: 'RL', FR: 'RR' },
    crosses: true,
  },
  {
    key: 'x-pattern',
    label: 'X-pattern',
    description: 'Every tire moves to the opposite corner.',
    moves: { FL: 'RR', RR: 'FL', FR: 'RL', RL: 'FR' },
    crosses: true,
  },
]

/** What's known about a tire model's tread: true, false, or never said. */
export type Directionality = boolean | null

export interface RotationOptions {
  /**
   * 'directional'     — at least one mounted tire can't cross; the pattern is decided
   * 'non-directional' — every mounted tire is known to cross safely; a pattern is recommended
   * 'unknown'         — nothing rules crossing out, but at least one tire's tread was never
   *                     recorded, so the app can't choose for you
   */
  known: 'directional' | 'non-directional' | 'unknown'
  patterns: RotationPattern[]
  recommended: RotationPattern | null
  /** Models whose directionality was never set, for "set it on the product". */
  unknownProductIds: string[]
}

/**
 * Which patterns apply, and whether the app can pick one on its own.
 *
 * One directional tire decides it outright — you can't cross half a set — even
 * if other tires on the car are unknown. Only when nothing is known to be
 * directional AND something is unknown does the choice fall back to the user.
 * Unknown is never quietly treated as non-directional: guessing wrong runs a
 * tread backwards.
 */
export function rotationOptions(
  lives: TireLife[],
  directionality: (productId: string | null) => Directionality,
): RotationOptions {
  const mounted = lives.filter(l => l.mounted)
  const values = mounted.map(l => ({ id: l.tire.product_id, d: directionality(l.tire.product_id) }))
  const unknownProductIds = [...new Set(values.filter(v => v.d == null && v.id).map(v => v.id as string))]
  const frontBack = ROTATION_PATTERNS.find(p => p.key === 'front-back')!

  if (values.some(v => v.d === true)) {
    return { known: 'directional', patterns: [frontBack], recommended: frontBack, unknownProductIds }
  }
  if (values.some(v => v.d == null)) {
    return { known: 'unknown', patterns: ROTATION_PATTERNS, recommended: null, unknownProductIds }
  }
  // Every tire can cross. X works regardless of drivetrain, which the app doesn't know.
  const x = ROTATION_PATTERNS.find(p => p.key === 'x-pattern')!
  return { known: 'non-directional', patterns: ROTATION_PATTERNS, recommended: x, unknownProductIds }
}

/**
 * A rotation dated before a tire's last recorded move would reorder its history
 * and corrupt its mileage, so it's refused rather than saved.
 */
export function rotationOdometerFloor(lives: TireLife[], events: TireEvent[]): number {
  const mountedIds = new Set(lives.filter(l => l.mounted).map(l => l.tire.id))
  return events
    .filter(e => mountedIds.has(e.tire_id))
    .reduce((max, e) => Math.max(max, e.odometer), 0)
}

/** Where each mounted tire ends up under a pattern. Corners with no tire are skipped. */
export function applyRotation(
  lives: TireLife[],
  pattern: RotationPattern,
): { tireId: string; from: TirePosition; to: TirePosition }[] {
  const out: { tireId: string; from: TirePosition; to: TirePosition }[] = []
  for (const l of lives) {
    if (!l.mounted || !l.position) continue
    const to = pattern.moves[l.position]
    if (to && to !== l.position) out.push({ tireId: l.tire.id, from: l.position, to })
  }
  return out
}

// ── Sets vs individuals ─────────────────────────────────────────────────────
//
// Most of the time four tires go on together, wear together and come off
// together — and then per-tire tracking is noise: four identical rows, a
// rotation button that changes nothing, corner labels on identical tires. The
// individual view only earns its place once the bunch DIFFERS: one tire
// replaced after damage, or a set mixed with tires from storage. Until then
// the UI treats the four as one set.

/** Tires within this many miles of each other count as having gone on together. */
export const SAME_SET_TOLERANCE_MILES = 500

export type SetShape = 'empty' | 'uniform' | 'mixed'

export interface SetView {
  shape: SetShape
  mounted: TireLife[]
  /** Why it's mixed, in words, for the one line that explains the switch. */
  reason: string | null
}

export function setView(lives: TireLife[]): SetView {
  const mounted = lives.filter(l => l.mounted)
  if (mounted.length === 0) return { shape: 'empty', mounted, reason: null }
  if (mounted.length < TIRE_POSITIONS.length) {
    return { shape: 'mixed', mounted, reason: `${mounted.length} of ${TIRE_POSITIONS.length} corners recorded` }
  }
  const models = new Set(mounted.map(l => l.tire.product_id ?? ''))
  if (models.size > 1) return { shape: 'mixed', mounted, reason: 'different tire models on the car' }
  const miles = mounted.map(l => l.miles)
  const spread = Math.max(...miles) - Math.min(...miles)
  if (spread > SAME_SET_TOLERANCE_MILES) {
    return { shape: 'mixed', mounted, reason: `tires ${spread.toLocaleString()} mi apart in wear` }
  }
  return { shape: 'uniform', mounted, reason: null }
}

export interface StoredSet {
  key: string
  productId: string | null
  tires: TireLife[]
  miles: number   // the set's typical mileage
}

/**
 * Tires in the garage, grouped back into the sets they came off the car as —
 * same model, roughly the same miles — so a seasonal swap is "put the winter
 * set on", not four separate picks.
 */
export function storedSets(lives: TireLife[]): StoredSet[] {
  const stored = lives.filter(l => !l.mounted && !l.retired).sort((a, b) => a.miles - b.miles)
  const sets: StoredSet[] = []
  for (const l of stored) {
    const home = sets.find(s =>
      s.productId === (l.tire.product_id ?? null)
      && Math.abs(s.miles - l.miles) <= SAME_SET_TOLERANCE_MILES)
    if (home) {
      home.tires.push(l)
      home.miles = Math.round(home.tires.reduce((sum, t) => sum + t.miles, 0) / home.tires.length)
    } else {
      sets.push({ key: `${l.tire.product_id ?? 'x'}|${l.tire.id}`, productId: l.tire.product_id ?? null, tires: [l], miles: l.miles })
    }
  }
  return sets
}

/** What happens to the tires a fitting displaces. */
export type OldTireFate = 'scrapped' | 'kept'

export interface FittingPlan {
  /** tireId null = a brand-new tire to create for that corner. */
  mounts: { position: TirePosition; tireId: string | null }[]
  /** Tires coming off the corners being fitted, and where they go. */
  offs: { tireId: string; from: TirePosition; fate: OldTireFate }[]
}

/**
 * Turn "which corners, with what, and what became of the old ones" into the
 * exact moves to record. Pure, so the rules can be tested without a database.
 */
export function planFitting(
  lives: TireLife[],
  incoming: Partial<Record<TirePosition, string | 'new'>>,
  oldFate: OldTireFate,
): FittingPlan {
  const mountedHere = mountedByPosition(lives)
  const goingOn = new Set(Object.values(incoming).filter((v): v is string => Boolean(v) && v !== 'new'))
  const mounts: FittingPlan['mounts'] = []
  const offs: FittingPlan['offs'] = []

  for (const position of TIRE_POSITIONS) {
    const choice = incoming[position]
    if (!choice) continue
    mounts.push({ position, tireId: choice === 'new' ? null : choice })
    const current = mountedHere.get(position)
    // A tire staying put (re-seated on its own corner) isn't displaced.
    if (current && !goingOn.has(current.tire.id)) {
      offs.push({ tireId: current.tire.id, from: position, fate: oldFate })
    }
  }
  return { mounts, offs }
}

/**
 * Products a fitting can install: anything typed as tires, with a name match as
 * a fallback for products created before types existed.
 */
export function tireProductChoices(
  products: { id: string; name: string; brand: string | null; product_type_id?: string | null }[],
  types: { id: string; name: string }[],
): { id: string; name: string }[] {
  const tireTypes = new Set(types.filter(t => /\b(tires?|tyres?)\b/i.test(t.name)).map(t => t.id))
  return products
    .filter(p => (p.product_type_id && tireTypes.has(p.product_type_id)) || /\b(tires?|tyres?)\b/i.test(p.name))
    .map(p => ({ id: p.id, name: [p.brand, p.name].filter(Boolean).join(' ') }))
}
