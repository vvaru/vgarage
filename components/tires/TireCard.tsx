'use client'

import { CircleGauge, AlertTriangle } from 'lucide-react'
import TireDiagram, { STATUS_COLOR, STATUS_LABEL } from './TireDiagram'
import { mountedByPosition, axleWarnings, setHealth, worstMounted, POSITION_LABELS, type TireLife } from '@/lib/tires'

/**
 * Tires as one more thing on the shelf — first card in "On hand", because a
 * set of tires is the most valuable stock most garages hold.
 */
export default function TireCard({ lives, onOpen }: { lives: TireLife[]; onOpen: () => void }) {
  const mounted = mountedByPosition(lives)
  const health = setHealth(lives)
  const worst = worstMounted(lives)
  const warnings = axleWarnings(lives)
  const slot = health.status === 'empty' ? 'empty' : health.status

  return (
    <button
      onClick={onOpen}
      className="text-left bg-surface border border-border rounded-2xl p-4 hover:border-accent/40 transition-colors"
    >
      <div className="flex items-center gap-1.5 mb-2">
        <CircleGauge size={12} className="text-accent" />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-faint">Tires</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="shrink-0">
          <TireDiagram mounted={mounted} size={54} />
        </div>
        <div className="min-w-0 flex-1">
          {health.mounted === 0 ? (
            <>
              <p className="text-foreground font-semibold text-sm">None fitted</p>
              <p className="text-faint text-xs mt-0.5">
                {health.spare > 0 ? `${health.spare} in storage` : 'Log a tire change to start'}
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold tracking-tight" style={{ color: STATUS_COLOR[slot] }}>
                {health.pctLeft != null ? `${Math.round(health.pctLeft)}%` : STATUS_LABEL[slot]}
              </p>
              <p className="text-faint text-xs mt-0.5">
                {health.pctLeft != null ? 'left on the worst corner' : `${health.mounted} fitted`}
                {health.spare > 0 && ` · ${health.spare} spare`}
              </p>
            </>
          )}
        </div>
      </div>

      {worst?.position && worst.miles > 0 && (
        <p className="text-faint text-[11px] mt-2 truncate">
          {POSITION_LABELS[worst.position]} · {worst.miles.toLocaleString()} mi
          {worst.remaining != null && (worst.remaining > 0
            ? ` · ${worst.remaining.toLocaleString()} to go`
            : ' · past its life')}
        </p>
      )}

      {warnings.length > 0 && (
        <p className="flex items-center gap-1 text-warn text-[11px] mt-1.5">
          <AlertTriangle size={11} className="shrink-0" />
          {warnings[0].axle} axle {warnings[0].differenceMiles.toLocaleString()} mi apart
        </p>
      )}
    </button>
  )
}
