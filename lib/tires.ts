import { differenceInCalendarDays, parseISO } from 'date-fns'

// ─────────────────────────────────────────────────────────────────────────────
// Tire life.
//
// One row per tire per fitting. The tire currently on a corner is simply the
// newest row for that position — derived rather than flagged, so nothing has to
// be marked removed and the history cannot contradict itself. Wear is measured
// in miles driven since fitting, against the life the tire was bought for.
// ─────────────────────────────────────────────────────────────────────────────

export const TIRE_POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const
export type TirePosition = (typeof TIRE_POSITIONS)[number] | 'SPARE'

export const POSITION_LABELS: Record<TirePosition, string> = {
  FL: 'Front left',
  FR: 'Front right',
  RL: 'Rear left',
  RR: 'Rear right',
  SPARE: 'Spare',
}

export const POSITION_SHORT: Record<TirePosition, string> = {
  FL: 'FL', FR: 'FR', RL: 'RL', RR: 'RR', SPARE: 'SP',
}

export interface TireInstallation {
  id: string
  user_id: string
  vehicle_id: string
  log_id: string | null
  position: TirePosition
  installed_odometer: number
  installed_date: string
  expected_life_miles: number | null
  brand: string | null
  model: string | null
  created_at?: string
}

export type TireStatus = 'good' | 'worn' | 'due' | 'over' | 'unknown' | 'empty'

/** Share of expected life used before a tire stops being simply "good". */
export const WEAR_BANDS = { worn: 0.7, due: 0.9 }

export interface TireLife {
  position: TirePosition
  install: TireInstallation | null
  milesOn: number | null      // driven since fitting
  daysOn: number | null
  expected: number | null
  remaining: number | null    // miles left before the expected life is used up
  pctUsed: number | null      // 0..100+, null when no expectation was recorded
  status: TireStatus
}

function statusFor(pctUsed: number | null, hasInstall: boolean): TireStatus {
  if (!hasInstall) return 'empty'
  if (pctUsed == null) return 'unknown'
  if (pctUsed >= 100) return 'over'
  if (pctUsed >= WEAR_BANDS.due * 100) return 'due'
  if (pctUsed >= WEAR_BANDS.worn * 100) return 'worn'
  return 'good'
}

/** The fitting currently on each corner: the newest row per position. */
export function currentInstalls(installs: TireInstallation[]): Map<TirePosition, TireInstallation> {
  const out = new Map<TirePosition, TireInstallation>()
  for (const t of installs) {
    const held = out.get(t.position)
    if (!held) { out.set(t.position, t); continue }
    // Odometer decides; date breaks a tie, then insertion order as a last resort.
    const newer = t.installed_odometer > held.installed_odometer
      || (t.installed_odometer === held.installed_odometer && t.installed_date > held.installed_date)
    if (newer) out.set(t.position, t)
  }
  return out
}

export function tireLife(
  installs: TireInstallation[],
  currentOdometer: number,
  positions: TirePosition[] = [...TIRE_POSITIONS],
  now = new Date(),
): TireLife[] {
  const current = currentInstalls(installs)
  return positions.map(position => {
    const install = current.get(position) ?? null
    if (!install) {
      return { position, install: null, milesOn: null, daysOn: null, expected: null, remaining: null, pctUsed: null, status: 'empty' as TireStatus }
    }
    // An odometer reading behind the fitting is bad data, not negative wear.
    const milesOn = Math.max(0, currentOdometer - install.installed_odometer)
    const expected = install.expected_life_miles && install.expected_life_miles > 0
      ? install.expected_life_miles
      : null
    const pctUsed = expected ? (milesOn / expected) * 100 : null
    let daysOn: number | null = null
    try { daysOn = Math.max(0, differenceInCalendarDays(now, parseISO(install.installed_date))) } catch { /* unparseable date */ }

    return {
      position,
      install,
      milesOn,
      daysOn,
      expected,
      remaining: expected ? expected - milesOn : null,
      pctUsed,
      status: statusFor(pctUsed, true),
    }
  })
}

/** The worst corner — what the summary card should lead with. */
export function worstTire(lives: TireLife[]): TireLife | null {
  const rank: Record<TireStatus, number> = { over: 5, due: 4, worn: 3, good: 2, unknown: 1, empty: 0 }
  const fitted = lives.filter(l => l.install)
  if (fitted.length === 0) return null
  return [...fitted].sort((a, b) =>
    rank[b.status] - rank[a.status] || (b.pctUsed ?? -1) - (a.pctUsed ?? -1))[0]
}

/** A whole-set headline: lowest remaining life across the fitted corners. */
export function setHealth(lives: TireLife[]): { pctLeft: number | null; status: TireStatus; fitted: number } {
  const fitted = lives.filter(l => l.install)
  const withPct = fitted.filter(l => l.pctUsed != null)
  if (fitted.length === 0) return { pctLeft: null, status: 'empty', fitted: 0 }
  if (withPct.length === 0) return { pctLeft: null, status: 'unknown', fitted: fitted.length }
  const worstPctUsed = Math.max(...withPct.map(l => l.pctUsed as number))
  return {
    pctLeft: Math.max(0, 100 - worstPctUsed),
    status: statusFor(worstPctUsed, true),
    fitted: fitted.length,
  }
}
