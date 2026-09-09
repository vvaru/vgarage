'use client'

import { CircleGauge } from 'lucide-react'
import TireDiagram, { STATUS_COLOR, STATUS_LABEL } from './TireDiagram'
import { setHealth, worstTire, POSITION_LABELS, type TireLife } from '@/lib/tires'

/** Compact tire-life summary; the full breakdown lives behind a tap. */
export default function TireLifeCard({ lives, onOpen }: { lives: TireLife[]; onOpen: () => void }) {
  const health = setHealth(lives)
  const worst = worstTire(lives)
  const color = STATUS_COLOR[health.status]

  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-surface border border-border rounded-2xl p-4 hover:border-accent/40 transition-colors"
    >
      <div className="flex items-center gap-2 mb-2">
        <CircleGauge size={14} className="text-accent" />
        <p className="text-xs font-semibold uppercase tracking-widest text-faint">Tire life</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <TireDiagram lives={lives} size={76} />
        </div>
        <div className="min-w-0 flex-1">
          {health.fitted === 0 ? (
            <>
              <p className="text-foreground font-semibold text-sm">Not tracked yet</p>
              <p className="text-faint text-xs mt-0.5">
                Log a tire replacement to start counting miles on each corner.
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold tracking-tight" style={{ color }}>
                {health.pctLeft != null ? `${Math.round(health.pctLeft)}%` : STATUS_LABEL[health.status]}
              </p>
              <p className="text-muted text-xs mt-0.5">
                {health.pctLeft != null ? 'life left on the worst corner' : `${health.fitted} tires tracked`}
              </p>
              {worst?.install && worst.milesOn != null && (
                <p className="text-faint text-[11px] mt-1 truncate">
                  {POSITION_LABELS[worst.position]} · {worst.milesOn.toLocaleString()} mi
                  {worst.remaining != null && worst.remaining > 0 && ` · ${worst.remaining.toLocaleString()} to go`}
                  {worst.remaining != null && worst.remaining <= 0 && ' · past its life'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </button>
  )
}
