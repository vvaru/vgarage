'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { X } from 'lucide-react'
import TireDiagram, { STATUS_COLOR, STATUS_LABEL } from './TireDiagram'
import { POSITION_LABELS, type TireLife, type TirePosition } from '@/lib/tires'

export default function TireDetailModal({
  lives, currentOdometer, onClose,
}: {
  lives: TireLife[]
  currentOdometer: number
  onClose: () => void
}) {
  const [picked, setPicked] = useState<TirePosition | null>(null)
  const active = lives.find(l => l.position === picked) ?? null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-border rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div>
            <h3 className="font-bold text-foreground text-lg">Tire life</h3>
            <p className="text-faint text-xs">{currentOdometer.toLocaleString()} mi on the clock</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground"><X size={20} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col sm:flex-row gap-6">
          <div className="shrink-0 self-center">
            <TireDiagram lives={lives} size={168} onPick={p => setPicked(p === picked ? null : p as TirePosition)} activePosition={picked} />
            <p className="text-faint text-[11px] text-center mt-2">Tap a corner</p>
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            {lives.map(l => {
              const isActive = l.position === picked
              const color = STATUS_COLOR[l.status]
              return (
                <button
                  key={l.position}
                  onClick={() => setPicked(isActive ? null : l.position)}
                  className={`w-full text-left rounded-2xl border p-3 transition-colors ${
                    isActive ? 'bg-surface-2/70 border-accent/40' : 'bg-surface-2/40 border-border hover:border-border-strong'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-foreground text-sm font-semibold">{POSITION_LABELS[l.position]}</span>
                    <span className="text-xs font-semibold" style={{ color }}>
                      {l.pctUsed != null ? `${Math.round(Math.max(0, 100 - l.pctUsed))}% left` : STATUS_LABEL[l.status]}
                    </span>
                  </div>

                  {l.pctUsed != null && (
                    <div className="h-1.5 rounded-full bg-surface-2 mt-2 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, 100 - l.pctUsed))}%`, background: color }} />
                    </div>
                  )}

                  {l.install ? (
                    <p className="text-faint text-[11px] mt-1.5">
                      {[
                        [l.install.brand, l.install.model].filter(Boolean).join(' ') || null,
                        `${l.milesOn?.toLocaleString()} mi on it`,
                        l.expected ? `of ${l.expected.toLocaleString()} expected` : 'no expected life set',
                        `fitted ${format(parseISO(l.install.installed_date), 'MMM yyyy')} at ${l.install.installed_odometer.toLocaleString()} mi`,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  ) : (
                    <p className="text-faint text-[11px] mt-1.5">No replacement logged for this corner yet.</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
