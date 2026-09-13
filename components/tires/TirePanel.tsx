'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CircleGauge, AlertTriangle, Archive, RotateCw } from 'lucide-react'
import TireDiagram, { STATUS_COLOR, STATUS_LABEL } from './TireDiagram'
import {
  mountedByPosition, axleWarnings, setHealth, tireName, setView,
  POSITION_LABELS, TIRE_POSITIONS, type TireLife, type TirePosition,
} from '@/lib/tires'

/**
 * The tire view, owned by the Products page — a tire is something you keep on a
 * shelf and swap onto the car, so it belongs with the rest of the inventory.
 */
export default function TirePanel({
  lives, currentOdometer, productName, trackPositions = true, onRotate, onResumeTracking,
}: {
  lives: TireLife[]
  currentOdometer: number
  productName: (id: string) => string
  /** false = mileage still counts, but corners aren't shown or asked for. */
  trackPositions?: boolean
  onRotate?: () => void
  onResumeTracking?: () => void
}) {
  const [picked, setPicked] = useState<TirePosition | null>(null)
  const mounted = mountedByPosition(lives)
  // Axle comparison needs to know which tires share an axle — meaningless untracked.
  const warnings = trackPositions ? axleWarnings(lives) : []
  const health = setHealth(lives)
  // Four tires that went on together are one thing. Per-tire detail, rotation
  // and corner labels only earn their place once the bunch actually differs.
  const view = setView(lives)
  const mixed = view.shape === 'mixed'
  const stored = lives.filter(l => !l.mounted && !l.retired)
  // Scrapped tires stop being tracked entirely; their history stays in the
  // database but nothing surfaces them again.

  const row = (l: TireLife, where: string) => {
    const color = STATUS_COLOR[l.status]
    return (
      <button
        key={l.tire.id}
        onClick={() => l.position && setPicked(l.position === picked ? null : l.position)}
        className={`w-full text-left rounded-2xl border p-3 transition-colors ${
          l.position && l.position === picked
            ? 'bg-surface-2/70 border-accent/40'
            : 'bg-surface-2/40 border-border hover:border-border-strong'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-foreground text-sm font-semibold truncate">{tireName(l, productName)}</span>
          <span className="text-xs font-semibold shrink-0" style={{ color }}>
            {l.pctUsed != null ? `${Math.round(Math.max(0, 100 - l.pctUsed))}% left` : STATUS_LABEL[l.status]}
          </span>
        </div>
        {l.pctUsed != null && (
          <div className="h-1.5 rounded-full bg-surface-2 mt-2 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, 100 - l.pctUsed))}%`, background: color }} />
          </div>
        )}
        <p className="text-faint text-[11px] mt-1.5">
          {[
            where,
            `${l.miles.toLocaleString()} mi turned`,
            l.expected ? `of ${l.expected.toLocaleString()}` : 'no expected life set',
            l.fittedDate ? `on since ${format(parseISO(l.fittedDate), 'MMM yyyy')}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-2xl p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <CircleGauge size={14} className="text-accent" />
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">On the car</p>
          </div>
          {onRotate && mixed && (
            <button onClick={onRotate}
              className="flex items-center gap-1.5 bg-accent/10 text-accent border border-accent/20 rounded-xl px-3 py-1.5 text-xs font-semibold hover:bg-accent/20 transition-colors">
              <RotateCw size={12} /> Rotate tires
            </button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-5">
          <div className="shrink-0 self-center">
            <TireDiagram
              mounted={mounted} size={150}
              onPick={p => setPicked(p === picked ? null : p)} activePosition={picked}
              unlocated={trackPositions && mixed ? null : { status: health.status, pctLeft: health.pctLeft }}
            />
            {mixed && <p className="text-faint text-[11px] text-center mt-2">{trackPositions ? 'Tap a corner' : 'Corners not tracked'}</p>}
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            {health.mounted === 0 ? (
              <p className="text-faint text-sm">
                Nothing fitted yet. Log a tire change and pick which tires went on.
              </p>
            ) : (
              <>
                <p className="text-2xl font-bold tracking-tight" style={{ color: STATUS_COLOR[health.status === 'empty' ? 'empty' : health.status] }}>
                  {health.pctLeft != null ? `${Math.round(health.pctLeft)}%` : STATUS_LABEL[health.status === 'empty' ? 'empty' : health.status]}
                </p>
                <p className="text-muted text-xs -mt-1">
                  {mixed ? `life left on the worst ${trackPositions ? 'corner' : 'tire'}` : 'life left'}
                  {health.spare > 0 && <span className="text-faint"> · {health.spare} more in storage</span>}
                </p>
                {view.shape === 'uniform' ? (
                  <div className="rounded-2xl border border-border bg-surface-2/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-foreground text-sm font-semibold truncate">
                        {tireName(view.mounted[0], productName)} · set of 4
                      </span>
                      <span className="text-xs font-semibold shrink-0" style={{ color: STATUS_COLOR[view.mounted[0].status] }}>
                        {view.mounted[0].pctUsed != null
                          ? `${Math.round(Math.max(0, 100 - view.mounted[0].pctUsed))}% left`
                          : STATUS_LABEL[view.mounted[0].status]}
                      </span>
                    </div>
                    {view.mounted[0].pctUsed != null && (
                      <div className="h-1.5 rounded-full bg-surface-2 mt-2 overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${Math.max(2, Math.min(100, 100 - view.mounted[0].pctUsed))}%`,
                          background: STATUS_COLOR[view.mounted[0].status],
                        }} />
                      </div>
                    )}
                    <p className="text-faint text-[11px] mt-1.5">
                      {[
                        `${view.mounted[0].miles.toLocaleString()} mi turned`,
                        view.mounted[0].expected ? `of ${view.mounted[0].expected.toLocaleString()}` : 'no expected life set',
                        view.mounted[0].fittedDate ? `on since ${format(parseISO(view.mounted[0].fittedDate), 'MMM yyyy')}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                ) : (
                  <>
                    {view.reason && (
                      <p className="text-faint text-[11px]">Tracking each tire — {view.reason}.</p>
                    )}
                    {trackPositions
                      ? TIRE_POSITIONS.map(pos => {
                          const l = mounted.get(pos)
                          return l
                            ? row(l, POSITION_LABELS[pos])
                            : (
                              <div key={pos} className="rounded-2xl border border-dashed border-border p-3">
                                <p className="text-faint text-xs">{POSITION_LABELS[pos]} — nothing recorded</p>
                              </div>
                            )
                        })
                      : lives.filter(l => l.mounted).map(l => row(l, 'On the car'))}
                  </>
                )}
                {!trackPositions && onResumeTracking && (
                  <button onClick={onResumeTracking} className="text-accent text-xs font-medium pt-1">
                    Track corners again →
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Same-axle mismatch is a handling concern; front-vs-rear is normal. */}
        {warnings.map(w => (
          <div key={w.axle} className="mt-3 flex items-start gap-2 bg-warn/10 border border-warn/20 rounded-xl p-3">
            <AlertTriangle size={15} className="text-warn shrink-0 mt-0.5" />
            <p className="text-foreground text-xs">
              <span className="font-semibold">{w.axle} axle mismatch.</span>{' '}
              These two are {w.differenceMiles.toLocaleString()} miles apart. Tires on the same axle
              wearing very differently can affect how the car handles.
            </p>
          </div>
        ))}
      </div>

      {stored.length > 0 && (
        <div className="bg-surface border border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Archive size={14} className="text-muted" />
            <p className="text-xs font-semibold uppercase tracking-widest text-faint">In storage · {stored.length}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {stored.map(l => row(l, 'Off the car'))}
          </div>
          <p className="text-faint text-[11px] mt-2">Mileage is paused while a tire is off the car.</p>
        </div>
      )}


    </div>
  )
}
