// Service schedule maths shared by Home and Services: where the odometer
// probably is today, what's due, and what the next few months will cost.
import { addMonths, differenceInDays, format, parseISO } from 'date-fns'
import type { FuelLog, ServiceCategory, ServiceCategoryProduct, ServiceLog } from '@/lib/types'

export interface CategoryStatus {
  cat: ServiceCategory
  lastLog: ServiceLog | null
  lastOdo: number | null
  lastDate: string | null
  nextOdo: number | null
  nextDate: string | null
  milesLeft: number | null
  daysLeft: number | null
  isOverdue: boolean
  isDueSoon: boolean
  /** 0..1 of the interval used up (1 = due). */
  used: number
}

const FALLBACK_MILES_PER_MONTH = 1250

type Odo = Pick<ServiceLog | FuelLog, 'date' | 'odometer'>
const readingsOf = (services: Odo[], fuel: Odo[]) =>
  [...services, ...fuel].filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer }))

export function milesPerMonth(services: Odo[], fuel: Odo[]): number {
  const r = readingsOf(services, fuel).sort((a, b) => a.date.localeCompare(b.date))
  if (r.length < 2) return FALLBACK_MILES_PER_MONTH
  const oldest = r[0], newest = r[r.length - 1]
  const days = differenceInDays(parseISO(newest.date), parseISO(oldest.date))
  if (days < 30 || newest.odo <= oldest.odo) return FALLBACK_MILES_PER_MONTH
  return Math.round((newest.odo - oldest.odo) / days * 30)
}

/** Latest reading carried forward at the usual pace, never below the car's stored odometer. */
export function estimatedOdometer(baseOdo: number, services: Odo[], fuel: Odo[], perMonth: number): { odo: number; latest: { date: string; odo: number } | null } {
  const latest = readingsOf(services, fuel).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  if (!latest || perMonth <= 0) return { odo: baseOdo, latest }
  const daysSince = differenceInDays(new Date(), parseISO(latest.date))
  if (daysSince <= 0) return { odo: Math.max(baseOdo, latest.odo), latest }
  return { odo: Math.max(baseOdo, latest.odo + Math.round((perMonth / 30) * daysSince)), latest }
}

export function categoryStatus(cat: ServiceCategory, logs: ServiceLog[], currentOdo: number): CategoryStatus {
  const catLogs = logs.filter(l => l.category_id === cat.id && l.odometer > 0).sort((a, b) => b.odometer - a.odometer)
  const last = catLogs[0] ?? null
  const lastOdo = last?.odometer ?? null
  const lastDate = last?.date ?? null
  const nextOdo = lastOdo != null && cat.interval_miles ? lastOdo + cat.interval_miles : cat.interval_miles ? currentOdo + cat.interval_miles : null
  const nextDate = lastDate != null && cat.interval_days
    ? format(new Date(parseISO(lastDate).getTime() + cat.interval_days * 86400000), 'yyyy-MM-dd')
    : cat.interval_days ? format(new Date(Date.now() + cat.interval_days * 86400000), 'yyyy-MM-dd') : null
  const milesLeft = nextOdo != null ? nextOdo - currentOdo : null
  const daysLeft = nextDate != null ? differenceInDays(parseISO(nextDate), new Date()) : null
  const isOverdue = (milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft < 0)
  const isDueSoon = !isOverdue && ((milesLeft != null && milesLeft <= 500) || (daysLeft != null && daysLeft <= 30))
  const usedMiles = cat.interval_miles && milesLeft != null ? 1 - milesLeft / cat.interval_miles : null
  const usedDays = cat.interval_days && daysLeft != null ? 1 - daysLeft / cat.interval_days : null
  const used = Math.min(1, Math.max(0, Math.max(usedMiles ?? 0, usedDays ?? 0)))
  return { cat, lastLog: last, lastOdo, lastDate, nextOdo, nextDate, milesLeft, daysLeft, isOverdue, isDueSoon, used: isOverdue ? 1 : used }
}

export function scheduleStatuses(categories: ServiceCategory[], logs: ServiceLog[], currentOdo: number): CategoryStatus[] {
  return categories
    .filter(c => c.interval_miles != null || c.interval_days != null)
    .map(c => categoryStatus(c, logs, currentOdo))
    .sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || Number(b.isDueSoon) - Number(a.isDueSoon) || b.used - a.used)
}

/** "In 3,174 mi", "Overdue by 2,660 mi", "In 12 days"… */
export function dueText(s: CategoryStatus): string {
  if (s.isOverdue) {
    if (s.milesLeft != null && s.milesLeft <= 0) return `Overdue by ${Math.abs(s.milesLeft).toLocaleString()} mi`
    if (s.daysLeft != null && s.daysLeft < 0) return `Overdue by ${Math.abs(s.daysLeft)} day${s.daysLeft === -1 ? '' : 's'}`
    return 'Overdue'
  }
  const parts: string[] = []
  if (s.milesLeft != null) parts.push(`${s.milesLeft.toLocaleString()} mi`)
  if (s.daysLeft != null && (s.milesLeft == null || s.daysLeft <= 60)) parts.push(s.daysLeft < 60 ? `${s.daysLeft} days` : `${Math.round(s.daysLeft / 30)} months`)
  return parts.length ? `In ${parts.join(' or ')}` : 'No schedule'
}

export interface UpcomingItem { s: CategoryStatus; estimate: number | null }

/** Services due within `months`, each with a cost estimate from catalog prices or recent costs. */
export function upcomingCosts(statuses: CategoryStatus[], logs: ServiceLog[], catalog: ServiceCategoryProduct[], months: number, currentOdo: number, perMonth: number): { items: UpcomingItem[]; total: number } {
  const cutoffDate = addMonths(new Date(), months)
  const cutoffMiles = currentOdo + months * perMonth
  const items = statuses
    .filter(s => s.isOverdue || (s.nextOdo != null && s.nextOdo <= cutoffMiles) || (s.nextDate != null && parseISO(s.nextDate) <= cutoffDate))
    .map(s => {
      const prods = catalog.filter(p => p.category_id === s.cat.id)
      let estimate: number | null = null
      if (prods.some(p => p.last_price != null)) estimate = prods.reduce((sum, p) => sum + Number(p.last_price ?? 0), 0)
      else {
        const costs = logs.filter(l => l.category_id === s.cat.id && l.cost != null).slice(0, 3).map(l => Number(l.cost))
        if (costs.length) estimate = costs.reduce((a, b) => a + b, 0) / costs.length
      }
      return { s, estimate }
    })
  return { items, total: items.reduce((sum, i) => sum + (i.estimate ?? 0), 0) }
}
