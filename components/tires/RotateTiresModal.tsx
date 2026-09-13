'use client'

import { useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { X, RotateCw, ArrowRight, Info } from 'lucide-react'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { withRetry, write } from '@/lib/recover'
import {
  rotationOptions, applyRotation, rotationOdometerFloor, tireName,
  POSITION_LABELS, type TireEvent, type TireLife,
} from '@/lib/tires'
import type { Product, ServiceCategory, Vehicle } from '@/lib/types'

type ProductU = Product & { unit?: string }

interface Props {
  vehicle: Vehicle
  lives: TireLife[]
  events: TireEvent[]
  products: ProductU[]
  categories: ServiceCategory[]
  onClose: () => void
  onSaved: () => void
  /** Hand an unknown tire model to the catalogue editor to set its tread once. */
  onEditProduct?: (productId: string) => void
}

const inputCls = 'w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground placeholder-faint focus:outline-none focus:border-accent/70 text-sm transition-all'

export default function RotateTiresModal({
  vehicle, lives, events, products, categories, onClose, onSaved, onEditProduct,
}: Props) {
  const { user } = useAuth()
  const tracking = vehicle.track_tire_positions !== false

  const directionality = (id: string | null) =>
    id ? (products.find(p => p.id === id)?.tire_directional ?? null) : null
  const productName = (id: string) => {
    const p = products.find(x => x.id === id)
    return p ? [p.brand, p.name].filter(Boolean).join(' ') : 'Tire'
  }

  const options = useMemo(() => rotationOptions(lives, directionality), [lives, products]) // eslint-disable-line react-hooks/exhaustive-deps
  const floor = useMemo(() => rotationOdometerFloor(lives, events), [lives, events])

  // Only a flagged-ish rotation category is offered as the default; the user sees
  // and can change it, so this is a convenience, not a hidden trigger.
  const rotationCat = categories.find(c => /rotat/i.test(c.name)) ?? null

  const [odometer, setOdometer] = useState(String(Math.max(vehicle.odometer, floor)))
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [patternKey, setPatternKey] = useState(options.recommended?.key ?? '')
  const [untrack, setUntrack] = useState(false)
  const [logService, setLogService] = useState(Boolean(rotationCat))
  const [categoryId, setCategoryId] = useState(rotationCat?.id ?? '')
  const [performedBy, setPerformedBy] = useState<'owner' | 'shop'>('owner')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = useRef<{ log: string; events: Record<string, string> } | null>(null)

  const pattern = options.patterns.find(p => p.key === patternKey) ?? null
  const moves = pattern && tracking && !untrack ? applyRotation(lives, pattern) : []
  const odo = parseInt(odometer)
  const odoTooLow = tracking && !untrack && !isNaN(odo) && odo < floor

  const mustChoose = tracking && options.known === 'unknown' && !pattern && !untrack
  const canSave = !isNaN(odo) && !odoTooLow && !mustChoose
    && (untrack || !tracking || moves.length > 0 || logService)

  async function handleSave() {
    if (!user || !canSave) return
    setSaving(true)
    setError(null)
    if (!ids.current) ids.current = { log: crypto.randomUUID(), events: {} }
    const { log: logId } = ids.current

    try {
      await ensureFreshSession()

      // The service record first, so tire events can point at it.
      const cat = categories.find(c => c.id === categoryId)
      if (logService && cat) {
        const { error: lErr } = await withRetry(() => write(supabase.from('service_logs').upsert({
          id: logId,
          user_id: user.id,
          vehicle_id: vehicle.id,
          service_type: cat.name,
          category_id: cat.id,
          record_type: cat.category_type,
          performed_by: performedBy,
          date,
          odometer: odo,
          cost: null,
          notes: pattern && moves.length > 0 ? `${pattern.label} rotation` : null,
        })), 2, 2500)
        if (lErr) throw new Error(lErr.message)
      }

      if (untrack) {
        // Mileage never depended on corners, so stopping here loses nothing it counts.
        const { error: vErr } = await withRetry(() => write(
          supabase.from('vehicles').update({ track_tire_positions: false }).eq('id', vehicle.id)), 2, 2500)
        if (vErr) throw new Error(vErr.message)
      } else {
        for (const m of moves) {
          ids.current.events[m.tireId] ??= crypto.randomUUID()
          const { error: eErr } = await withRetry(() => write(supabase.from('tire_events').upsert({
            id: ids.current!.events[m.tireId],
            user_id: user.id,
            vehicle_id: vehicle.id,
            tire_id: m.tireId,
            log_id: logService && cat ? logId : null,
            position: m.to,
            odometer: odo,
            date,
          })), 2, 2500)
          if (eErr) throw new Error(eErr.message)
        }
      }

      onSaved()
    } catch (e) {
      setError(`Couldn’t save (${e instanceof Error ? e.message : String(e)}). Nothing was lost — tap Rotate to try again.`)
    } finally {
      setSaving(false)
    }
  }

  const byId = new Map(lives.map(l => [l.tire.id, l]))

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface border border-border rounded-3xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center"><RotateCw size={17} className="text-accent" /></div>
            <h3 className="font-bold text-foreground text-lg">Rotate tires</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground"><X size={20} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Odometer</label>
              <input type="number" inputMode="numeric" value={odometer} onChange={e => setOdometer(e.target.value)} className={inputCls} />
            </div>
          </div>
          {odoTooLow && (
            <p className="text-danger text-xs">
              A tire last moved at {floor.toLocaleString()} mi — a rotation before that would scramble its mileage.
            </p>
          )}

          {!tracking ? (
            <div className="flex items-start gap-2 bg-surface-2/50 border border-border rounded-2xl p-3">
              <Info size={14} className="text-muted shrink-0 mt-0.5" />
              <p className="text-muted text-xs">
                Corners aren’t tracked for this car, so this just records that a rotation happened.
                Tire mileage is unaffected either way.
              </p>
            </div>
          ) : (
            <div>
              <p className="text-xs font-medium text-muted mb-2">Pattern</p>

              {options.known === 'directional' && (
                <p className="text-faint text-xs mb-2">
                  Your tires are directional, so they can only move front-to-back on their own side.
                </p>
              )}
              {options.known === 'non-directional' && (
                <p className="text-faint text-xs mb-2">
                  Your tires can cross sides. X-pattern suits any drivetrain; change it if you used another.
                </p>
              )}
              {options.known === 'unknown' && (
                <div className="bg-warn/10 border border-warn/20 rounded-2xl p-3 mb-2 space-y-1.5">
                  <p className="text-foreground text-xs">
                    It isn’t recorded whether{' '}
                    {options.unknownProductIds.map((id, i) => (
                      <span key={id}>
                        {i > 0 && ', '}
                        <span className="font-semibold">{productName(id)}</span>
                      </span>
                    ))}
                    {options.unknownProductIds.length === 0 && ' these tires'} {options.unknownProductIds.length > 1 ? 'are' : 'is'} directional,
                    so pick the pattern you used — or skip tracking corners.
                  </p>
                  {onEditProduct && options.unknownProductIds[0] && (
                    <button onClick={() => { onClose(); onEditProduct(options.unknownProductIds[0]) }}
                      className="text-accent text-xs font-medium">Set it on the product so Rotate can choose next time →</button>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                {options.patterns.map(p => (
                  <button key={p.key} onClick={() => { setPatternKey(p.key); setUntrack(false) }}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                      patternKey === p.key && !untrack
                        ? 'bg-accent/10 border-accent/40'
                        : 'bg-surface-2/40 border-border hover:border-border-strong'
                    }`}>
                    <span className="text-foreground text-sm font-semibold">{p.label}</span>
                    {options.recommended?.key === p.key && <span className="text-accent text-[10px] font-semibold ml-2">RECOMMENDED</span>}
                    <span className="text-faint text-[11px] block">{p.description}</span>
                  </button>
                ))}

                {options.known === 'unknown' && (
                  <button onClick={() => { setUntrack(true); setPatternKey('') }}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                      untrack ? 'bg-accent/10 border-accent/40' : 'bg-surface-2/40 border-dashed border-border hover:border-border-strong'
                    }`}>
                    <span className="text-foreground text-sm font-semibold">I’d rather not track corners</span>
                    <span className="text-faint text-[11px] block">
                      Stop asking which corner each tire is on. Mileage and life keep counting —
                      they never depended on corners.
                    </span>
                  </button>
                )}
              </div>

              {moves.length > 0 && (
                <div className="mt-3 bg-surface-2/40 border border-border rounded-2xl p-3 space-y-1">
                  {moves.map(m => {
                    const life = byId.get(m.tireId)
                    return (
                      <p key={m.tireId} className="text-xs text-muted flex items-center gap-1.5">
                        <span className="text-foreground w-20 shrink-0">{POSITION_LABELS[m.from]}</span>
                        <ArrowRight size={11} className="text-faint shrink-0" />
                        <span className="text-foreground w-20 shrink-0">{POSITION_LABELS[m.to]}</span>
                        {life && <span className="text-faint truncate">{tireName(life, productName)} · {life.miles.toLocaleString()} mi</span>}
                      </p>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* A rotation is also a service — logging it keeps the schedule honest. */}
          <div className="bg-surface-2/40 border border-border rounded-2xl p-3 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={logService} onChange={e => setLogService(e.target.checked)}
                disabled={categories.length === 0} className="accent-[var(--color-accent)]" />
              <span className="text-foreground text-sm">Also log it as a service</span>
            </label>
            {logService && (
              <div className="flex gap-2">
                <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={`${inputCls} flex-1`}>
                  <option value="">Pick a category…</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {(['owner', 'shop'] as const).map(v => (
                  <button key={v} onClick={() => setPerformedBy(v)}
                    className={`px-3 rounded-xl text-xs font-semibold border transition-colors ${
                      performedBy === v ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface-2 text-muted border-border-strong'
                    }`}>{v === 'owner' ? 'DIY' : 'Shop'}</button>
                ))}
              </div>
            )}
            {logService && !categoryId && <p className="text-warn text-[11px]">Pick a category, or untick to skip logging.</p>}
          </div>
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 space-y-3">
          {error && <p className="text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={!canSave || saving || (logService && !categoryId)}
              className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors">
              {saving ? 'Saving…' : untrack ? 'Save and stop tracking corners' : 'Rotate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
