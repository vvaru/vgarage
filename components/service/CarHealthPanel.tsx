'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import CarHealthMap from './CarHealthMap'
import { LEVEL_COLOR, LEVEL_LABEL, ZONES, type ZoneId, type ZoneItem, type ZoneLevel, type ZoneState } from '@/lib/carZones'
import type { TirePosition } from '@/lib/tires'

/**
 * The Services page's resting state on a wide screen: the car, big, with every
 * region it can speak to listed beside it. Picking a region highlights it and
 * its jobs; picking a job opens it.
 */
export default function CarHealthPanel({
  states, tireCorners, onItem, heading,
}: {
  states: Map<ZoneId, ZoneState>
  tireCorners: Map<TirePosition, ZoneLevel> | null
  onItem: (item: ZoneItem) => void
  heading: string
}) {
  const [active, setActive] = useState<ZoneId | null>(null)

  const counts = { due: 0, soon: 0 }
  for (const st of states.values()) {
    for (const it of st.items) if (it.level === 'due' || it.level === 'soon') counts[it.level]++
  }

  // Regions with something to say first, worst first; untracked ones last.
  const rank: Record<ZoneLevel, number> = { due: 3, soon: 2, ok: 1, none: 0 }
  const ordered = ZONES.map(z => states.get(z.id)!).sort((a, b) => rank[b.level] - rank[a.level])

  return (
    <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-6 p-6 lg:p-8">
      <div className="xl:flex-1 flex flex-col items-center min-h-0">
        <div className="self-stretch mb-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-faint">Vehicle health</p>
          <p className="text-foreground font-bold text-lg">{heading}</p>
          <p className="text-muted text-sm">
            {counts.due > 0 && <span className="text-danger font-semibold">{counts.due} need{counts.due === 1 ? 's' : ''} doing</span>}
            {counts.due > 0 && counts.soon > 0 && ' · '}
            {counts.soon > 0 && <span className="text-warn font-semibold">{counts.soon} coming up</span>}
            {counts.due === 0 && counts.soon === 0 && 'Nothing pressing'}
          </p>
        </div>
        <div className="w-full max-w-[340px] flex-1 min-h-[460px] max-h-[74vh] py-2">
          <CarHealthMap
            states={states}
            tireCorners={tireCorners}
            activeZone={active}
            onZone={z => setActive(prev => (prev === z ? null : z))}
          />
        </div>
        <div className="flex items-center gap-4 text-[11px] text-faint">
          {(['due', 'soon', 'ok'] as const).map(l => (
            <span key={l} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: LEVEL_COLOR[l] }} />
              {LEVEL_LABEL[l]}
            </span>
          ))}
        </div>
      </div>

      <div className="xl:w-[360px] xl:overflow-y-auto space-y-2">
        {ordered.map(st => {
          const isActive = active === st.zone.id
          const dim = active != null && !isActive
          return (
            <div
              key={st.zone.id}
              className={`rounded-2xl border p-3 transition-all ${
                isActive ? 'bg-surface-2/70 border-accent/40' : 'bg-surface border-border'
              } ${dim ? 'opacity-45' : ''}`}
            >
              <button
                onClick={() => setActive(prev => (prev === st.zone.id ? null : st.zone.id))}
                className="w-full flex items-center justify-between gap-2 text-left"
              >
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: LEVEL_COLOR[st.level], opacity: st.level === 'none' ? 0.35 : 1 }} />
                  <span className="text-foreground text-sm font-semibold">{st.zone.label}</span>
                </span>
                <span className="text-xs font-medium" style={{ color: st.level === 'none' ? undefined : LEVEL_COLOR[st.level] }}>
                  <span className={st.level === 'none' ? 'text-faint' : ''}>{LEVEL_LABEL[st.level]}</span>
                </span>
              </button>
              {st.items.length > 0 && (
                <div className="mt-2 space-y-1">
                  {st.items.map(it => (
                    <button key={it.id} onClick={() => onItem(it)}
                      className="w-full flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 hover:bg-surface-2/60 transition-colors text-left">
                      <span className="min-w-0">
                        <span className="text-muted text-xs block truncate">{it.name}</span>
                        {it.detail && <span className="text-[11px] block truncate" style={{ color: LEVEL_COLOR[it.level] }}>{it.detail}</span>}
                      </span>
                      <ChevronRight size={13} className="text-faint shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
