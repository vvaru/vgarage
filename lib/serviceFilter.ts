import { subDays, subMonths, subYears, parseISO } from 'date-fns'
import type { ServiceLog } from '@/lib/types'

// Single definition of how service records are filtered and sorted. The history
// page and every popup that offers a service list import from here, so changing
// a filter option changes it everywhere at once.

export type CostFilter = 'week' | 'month' | '3mo' | '6mo' | 'year' | 'all'
export type SortKey = 'date' | 'odometer' | 'cost'

export const COST_FILTERS: { key: CostFilter; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: '3mo', label: '3 Mo' },
  { key: '6mo', label: '6 Mo' },
  { key: 'year', label: 'Year' },
]

export const SORT_KEYS: SortKey[] = ['date', 'odometer', 'cost']

export interface ServiceFilterState {
  costFilter: CostFilter
  sortKey: SortKey
  typeFilter: string | null
  query: string
}

export const EMPTY_FILTER: ServiceFilterState = {
  costFilter: 'all', sortKey: 'date', typeFilter: null, query: '',
}

export const isFilterActive = (f: ServiceFilterState): boolean =>
  f.costFilter !== 'all' || f.sortKey !== 'date' || f.typeFilter !== null || f.query.trim() !== ''

export function cutoffDate(filter: CostFilter, now = new Date()): Date | null {
  if (filter === 'week') return subDays(now, 7)
  if (filter === 'month') return subMonths(now, 1)
  if (filter === '3mo') return subMonths(now, 3)
  if (filter === '6mo') return subMonths(now, 6)
  if (filter === 'year') return subYears(now, 1)
  return null
}

// Filter then sort, so both surfaces order results identically.
export function applyServiceFilter(logs: ServiceLog[], f: ServiceFilterState): ServiceLog[] {
  const cutoff = cutoffDate(f.costFilter)
  const q = f.query.trim().toLowerCase()
  const out = logs.filter(l => {
    if (cutoff && parseISO(l.date) < cutoff) return false
    if (f.typeFilter && l.service_type !== f.typeFilter) return false
    if (q && !`${l.service_type} ${l.shop_name ?? ''} ${l.notes ?? ''}`.toLowerCase().includes(q)) return false
    return true
  })
  return out.sort((a, b) => {
    if (f.sortKey === 'odometer') return b.odometer - a.odometer
    if (f.sortKey === 'cost') return Number(b.cost ?? 0) - Number(a.cost ?? 0)
    return b.date.localeCompare(a.date)
  })
}

// A DIY record where we know what a shop would have charged.
export const diySaving = (log: ServiceLog): number | null => {
  if (log.performed_by !== 'owner' || log.shop_equivalent_cost == null) return null
  return Number(log.shop_equivalent_cost) - Number(log.cost ?? 0)
}

export const totalDiySaving = (logs: ServiceLog[]): number =>
  logs.reduce((sum, l) => sum + Math.max(0, diySaving(l) ?? 0), 0)
