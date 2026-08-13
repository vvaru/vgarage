'use client'

import { Search } from 'lucide-react'
import { COST_FILTERS, SORT_KEYS, EMPTY_FILTER, type ServiceFilterState } from '@/lib/serviceFilter'

// The one filter UI. Rendered inline inside a picker, or inside the history
// page's Filter & Sort dialog — same controls either way.
interface Props {
  value: ServiceFilterState
  onChange: (next: ServiceFilterState) => void
  types: string[]
  knownTypes?: Set<string>
  showSearch?: boolean
  compact?: boolean
}

export default function ServiceFilterPanel({
  value, onChange, types, knownTypes, showSearch = false, compact = false,
}: Props) {
  const set = (patch: Partial<ServiceFilterState>) => onChange({ ...value, ...patch })
  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
      active ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong'
    }`

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      {showSearch && (
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            type="text"
            placeholder="Search services…"
            value={value.query}
            onChange={e => set({ query: e.target.value })}
            className="w-full bg-surface-2 border border-border-strong rounded-xl pl-9 pr-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-muted mb-2">Time Range</label>
        <div className="flex flex-wrap gap-2">
          {COST_FILTERS.map(f => (
            <button key={f.key} onClick={() => set({ costFilter: f.key })} className={chip(value.costFilter === f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-muted mb-2">Sort By</label>
        <div className="flex gap-2">
          {SORT_KEYS.map(k => (
            <button key={k} onClick={() => set({ sortKey: k })} className={`flex-1 py-2 rounded-xl text-sm font-medium capitalize transition-colors border ${
              value.sortKey === k ? 'bg-accent/10 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong'
            }`}>{k}</button>
          ))}
        </div>
      </div>

      {types.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-muted mb-2">Service Type</label>
          <select
            value={value.typeFilter ?? ''}
            onChange={e => set({ typeFilter: e.target.value || null })}
            className="w-full bg-surface-2 border border-border-strong rounded-xl px-4 py-3 text-foreground focus:outline-none focus:border-accent/70 transition-all appearance-none"
          >
            <option value="">All Types</option>
            {types.map(t => (
              <option key={t} value={t}>{t}{knownTypes && !knownTypes.has(t) ? ' (uncategorized)' : ''}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

export const resetFilter = () => ({ ...EMPTY_FILTER })
