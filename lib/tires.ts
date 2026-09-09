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
