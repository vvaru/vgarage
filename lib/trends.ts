// ─────────────────────────────────────────────────────────────────────────────
// Driving and spending trends, from the readings and costs already logged.
//
// Miles: every fuel and service odometer reading is a point on the car's
// timeline. Miles between two readings are spread evenly over the days between
// them, giving a miles-per-day series. Days after the last reading are unknown,
// so "this week" means the 7 days ending at the latest reading, and every
// comparison is stated against that date.
//
// Money ("running costs"): fuel + services. A shop service counts at what it
// was charged; a DIY service at the parts it used (its saved cost), so parts
// sitting on the shelf aren't counted until they're used and nothing is
// counted twice.
// ─────────────────────────────────────────────────────────────────────────────

import type { FuelLog, ServiceLog } from '@/lib/types'

const DAY = 86_400_000
/** 'YYYY-MM-DD' → whole days since 1970-01-01 (UTC, so time zones can't shift it). */
export const dayNum = (d: string): number => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY)
export const dayStr = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10)
export const todayStr = (): string => {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
const monthKey = (d: string) => d.slice(0, 7)
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)

export interface Reading { date: string; odometer: number }

export interface MileageSeries {
  /** Day number → miles driven that day. Covers firstDay+1 … lastDay. */
  daily: Map<number, number>
  firstDay: number
  lastDay: number
  readings: Reading[]
  /** Readings left out because they went backwards (e.g. a typo). */
  skipped: Reading[]
}

export function mileageSeries(fuel: Pick<FuelLog, 'date' | 'odometer'>[], services: Pick<ServiceLog, 'date' | 'odometer'>[]): MileageSeries | null {
  const byDay = new Map<number, number>()
  for (const r of [...fuel, ...services]) {
    if (!r.date || !(r.odometer > 0)) continue
    const d = dayNum(r.date)
    byDay.set(d, Math.max(byDay.get(d) ?? 0, r.odometer))
  }
  const days = [...byDay.keys()].sort((a, b) => a - b)
  const kept: { d: number; o: number }[] = []
  const skipped: Reading[] = []
  for (const d of days) {
    const o = byDay.get(d)!
    if (kept.length && o < kept[kept.length - 1].o) { skipped.push({ date: dayStr(d), odometer: o }); continue }
    kept.push({ d, o })
  }
  if (kept.length < 2) return null
  const daily = new Map<number, number>()
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1], b = kept[i]
    const span = b.d - a.d
    const per = (b.o - a.o) / span
    for (let d = a.d + 1; d <= b.d; d++) daily.set(d, per)
  }
  return { daily, firstDay: kept[0].d, lastDay: kept[kept.length - 1].d, readings: kept.map(k => ({ date: dayStr(k.d), odometer: k.o })), skipped }
}

/** Miles in the `len` days ending on `end` (inclusive); null when the series doesn't cover them. */
export function milesIn(s: MileageSeries, end: number, len: number): number | null {
  const start = end - len + 1
  if (start <= s.firstDay || end > s.lastDay) return null
  let m = 0
  for (let d = start; d <= end; d++) m += s.daily.get(d) ?? 0
  return m
}

export interface DrivingSummary {
  through: string             // the date "this week" ends on (latest reading)
  daysSinceReading: number
  week: number
  prevWeek: number | null
  avg8: number | null         // mean of the 8 weeks before this one
  lastYear: number | null     // the same 7 days a year earlier (364 days, so weekdays line up)
  peak: { miles: number; through: string } | null   // busiest 7 days in the past year
  seasonAvg: number | null    // average week in this calendar month last year
  avgPerDay90: number | null
  weekly: { through: string; miles: number; lastYear: number | null }[]   // last 26 weeks, oldest first
  monthly: { month: string; miles: number; lastYear: number | null; partial: boolean }[]  // last 12 months
}

export function drivingSummary(s: MileageSeries, today = todayStr()): DrivingSummary | null {
  const end = s.lastDay
  const week = milesIn(s, end, 7)
  if (week == null) return null
  const weeks8 = Array.from({ length: 8 }, (_, i) => milesIn(s, end - 7 * (i + 1), 7)).filter((x): x is number => x != null)
  let peak: DrivingSummary['peak'] = null
  for (let e = end; e > end - 365; e--) {
    const m = milesIn(s, e, 7)
    if (m != null && (!peak || m > peak.miles)) peak = { miles: m, through: dayStr(e) }
  }
  const thisMonth = new Date(end * DAY).getUTCMonth()
  const ly: number[] = []
  for (let e = end - 365 - 31; e <= end - 365 + 31; e++) {
    if (new Date(e * DAY).getUTCMonth() !== thisMonth) continue
    const m = milesIn(s, e, 7)
    if (m != null) ly.push(m)
  }
  const weekly = Array.from({ length: 26 }, (_, i) => {
    const e = end - 7 * (25 - i)
    return { through: dayStr(e), miles: milesIn(s, e, 7) ?? 0, lastYear: milesIn(s, e - 364, 7) }
  }).filter(w => w.miles > 0 || w.lastYear != null)

  const monthly: DrivingSummary['monthly'] = []
  const endDate = new Date(end * DAY)
  for (let i = 11; i >= 0; i--) {
    const y = endDate.getUTCFullYear(), m = endDate.getUTCMonth() - i
    const first = Math.floor(Date.UTC(y, m, 1) / DAY), last = Math.floor(Date.UTC(y, m + 1, 0) / DAY)
    const covered = (a: number, b: number) => {
      let total = 0, any = false
      for (let d = a; d <= b; d++) { const v = s.daily.get(d); if (v != null) { total += v; any = true } }
      return any ? total : null
    }
    const miles = covered(first, Math.min(last, end))
    if (miles == null) continue
    const lyFirst = Math.floor(Date.UTC(y - 1, m, 1) / DAY), lyLast = Math.floor(Date.UTC(y - 1, m + 1, 0) / DAY)
    monthly.push({ month: dayStr(first).slice(0, 7), miles, lastYear: covered(lyFirst, Math.min(lyLast, end - 365)), partial: last > end })
  }

  return {
    through: dayStr(end),
    daysSinceReading: Math.max(0, dayNum(today) - end),
    week,
    prevWeek: milesIn(s, end - 7, 7),
    avg8: weeks8.length >= 3 ? sum(weeks8) / weeks8.length : null,
    lastYear: milesIn(s, end - 364, 7),
    peak,
    seasonAvg: ly.length ? sum(ly) / ly.length : null,
    avgPerDay90: (() => { const m = milesIn(s, end, 90); return m == null ? null : m / 90 })(),
    weekly,
    monthly,
  }
}

/* ── Money ──────────────────────────────────────────────────────────────── */

export interface MonthSpend { month: string; fuel: number; service: number; total: number }

export function monthlySpend(fuel: Pick<FuelLog, 'date' | 'total_cost'>[], services: Pick<ServiceLog, 'date' | 'cost'>[]): Map<string, MonthSpend> {
  const out = new Map<string, MonthSpend>()
  const at = (m: string) => {
    let v = out.get(m)
    if (!v) { v = { month: m, fuel: 0, service: 0, total: 0 }; out.set(m, v) }
    return v
  }
  for (const f of fuel) if (f.date && f.total_cost) { const v = at(monthKey(f.date)); v.fuel += f.total_cost; v.total += f.total_cost }
  for (const s of services) if (s.date && s.cost) { const v = at(monthKey(s.date)); v.service += s.cost; v.total += s.cost }
  return out
}

const shiftMonth = (m: string, by: number) => {
  const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}
export const monthLabel = (m: string, withYear = false) =>
  new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' })

export interface SpendSummary {
  month: string
  dayOfMonth: number
  thisMonth: MonthSpend
  lastMonthSameDays: number        // last month up to the same day, for a fair pace comparison
  lastMonth: MonthSpend
  sameMonthLastYear: MonthSpend | null
  ytd: { fuel: number; service: number; total: number }
  ytdLastYear: { fuel: number; service: number; total: number } | null
  last12: { fuel: number; service: number; total: number }
  prev12: { fuel: number; service: number; total: number } | null
  months: (MonthSpend & { lastYear: number | null })[]   // last 12 months, oldest first
}

export function spendSummary(fuel: Pick<FuelLog, 'date' | 'total_cost'>[], services: Pick<ServiceLog, 'date' | 'cost'>[], today = todayStr()): SpendSummary {
  const by = monthlySpend(fuel, services)
  const get = (m: string): MonthSpend => by.get(m) ?? { month: m, fuel: 0, service: 0, total: 0 }
  const month = monthKey(today)
  const dom = +today.slice(8, 10)
  const lastM = shiftMonth(month, -1)
  const upTo = (rows: { date: string; v: number | null }[], m: string, day: number) =>
    sum(rows.filter(r => r.date && monthKey(r.date) === m && +r.date.slice(8, 10) <= day).map(r => r.v ?? 0))
  const rows = [...fuel.map(f => ({ date: f.date, v: f.total_cost })), ...services.map(s => ({ date: s.date, v: s.cost }))]
  const earliest = rows.map(r => r.date).filter(Boolean).sort()[0] ?? today
  const year = today.slice(0, 4), lastYear = String(+year - 1)
  const span = (from: string, to: string) => {
    const pick = (d: string) => d >= from && d <= to
    const f = sum(fuel.filter(x => x.date && pick(x.date)).map(x => x.total_cost ?? 0))
    const s = sum(services.filter(x => x.date && pick(x.date)).map(x => x.cost ?? 0))
    return { fuel: f, service: s, total: f + s }
  }
  const ago = (days: number) => dayStr(dayNum(today) - days)
  return {
    month,
    dayOfMonth: dom,
    thisMonth: get(month),
    lastMonthSameDays: upTo(rows, lastM, dom),
    lastMonth: get(lastM),
    sameMonthLastYear: earliest <= `${shiftMonth(month, -12)}-31` ? get(shiftMonth(month, -12)) : null,
    ytd: span(`${year}-01-01`, today),
    ytdLastYear: earliest <= `${lastYear}-01-31` ? span(`${lastYear}-01-01`, `${lastYear}${today.slice(4)}`) : null,
    last12: span(ago(364), today),
    prev12: earliest <= ago(700) ? span(ago(729), ago(365)) : null,
    months: Array.from({ length: 12 }, (_, i) => {
      const m = shiftMonth(month, i - 11)
      const ly = by.get(shiftMonth(m, -12))
      return { ...get(m), lastYear: earliest <= `${shiftMonth(m, -12)}-31` ? (ly?.total ?? 0) : null }
    }),
  }
}

export const pctChange = (now: number | null | undefined, then: number | null | undefined): number | null =>
  now == null || then == null || then === 0 ? null : ((now - then) / then) * 100

/* ── Plain-language insights ────────────────────────────────────────────── */

export interface Insight { id: string; icon: 'route' | 'payments' | 'local_gas_station' | 'trending_up' | 'trending_down' | 'speed' | 'savings'; tone: 'good' | 'bad' | 'neutral'; text: string }

const mi = (n: number) => `${Math.round(n).toLocaleString()} mi`
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`

export function insights(d: DrivingSummary | null, s: SpendSummary, mpgRecent: number | null, mpgBefore: number | null): Insight[] {
  const out: Insight[] = []
  if (d) {
    const vs = pctChange(d.week, d.avg8)
    if (vs != null && Math.abs(vs) >= 15) {
      out.push({ id: 'drive-avg', icon: 'route', tone: 'neutral', text: `You drove ${Math.abs(Math.round(vs))}% ${vs > 0 ? 'more' : 'less'} than usual this week: ${mi(d.week)} against your 8-week average of ${mi(d.avg8!)}.` })
    }
    const vy = pctChange(d.week, d.lastYear)
    if (vy != null && Math.abs(vy) >= 20) {
      out.push({ id: 'drive-ly', icon: 'route', tone: 'neutral', text: `${vy > 0 ? 'More' : 'Less'} driving than this week last year: ${mi(d.week)} vs ${mi(d.lastYear!)}.` })
    }
    if (d.peak && d.week >= d.peak.miles * 0.95) out.push({ id: 'drive-peak', icon: 'route', tone: 'neutral', text: `Your busiest week of the past year: ${mi(d.week)}.` })
  }
  const lastSame = s.lastMonthSameDays
  if (lastSame > 0 && s.thisMonth.total > 0) {
    const p = pctChange(s.thisMonth.total, lastSame)!
    if (Math.abs(p) >= 20) {
      out.push({ id: 'spend-pace', icon: p > 0 ? 'trending_up' : 'trending_down', tone: p > 0 ? 'bad' : 'good',
        text: `${usd(s.thisMonth.total)} spent so far this month, ${Math.abs(Math.round(p))}% ${p > 0 ? 'more' : 'less'} than by this day last month (${usd(lastSame)}).` })
    }
  }
  if (s.ytdLastYear && s.ytdLastYear.total > 0) {
    const p = pctChange(s.ytd.total, s.ytdLastYear.total)!
    if (Math.abs(p) >= 10) {
      out.push({ id: 'spend-ytd', icon: 'payments', tone: p > 0 ? 'bad' : 'good',
        text: `This year so far: ${usd(s.ytd.total)}, ${Math.abs(Math.round(p))}% ${p > 0 ? 'above' : 'below'} the same point last year.` })
    }
  }
  if (mpgRecent != null && mpgBefore != null) {
    const p = pctChange(mpgRecent, mpgBefore)!
    if (Math.abs(p) >= 5) {
      out.push({ id: 'mpg', icon: 'local_gas_station', tone: p > 0 ? 'good' : 'bad',
        text: `Fuel economy is ${p > 0 ? 'up' : 'down'} ${Math.abs(p).toFixed(0)}% over your last few fill-ups (${mpgRecent.toFixed(1)} vs ${mpgBefore.toFixed(1)} mpg).` })
    }
  }
  return out
}
