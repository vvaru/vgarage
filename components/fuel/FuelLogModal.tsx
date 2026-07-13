'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { X, Fuel } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { withRetry, withTimeout } from '@/lib/recover'
import { recomputeFuelMpg } from '@/lib/fuelMpg'
import type { FuelLog, Vehicle } from '@/lib/types'

interface Props {
  vehicle: Vehicle
  log?: FuelLog | null   // present = edit mode
  onClose: () => void
  onSaved: () => void
}

const num = (s: string): number | null => {
  const n = parseFloat(s)
  return s.trim() !== '' && !isNaN(n) ? n : null
}

// Each modal session writes to a fixed row id, so re-tapping Save just re-writes the
// same row — never a duplicate. So on a stall we can safely tell the user to retry.
function saveError(raw: string): string {
  if (/abort|timeout|timed out|failed to fetch|network/i.test(raw))
    return 'Couldn’t reach the server — your entry is still here. Tap Save to try again.'
  return raw || 'Something went wrong. Please try again.'
}

export default function FuelLogModal({ vehicle, log, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const isEdit = !!log

  const [date, setDate] = useState(log?.date ?? format(new Date(), 'yyyy-MM-dd'))
  const [odometer, setOdometer] = useState(log ? String(log.odometer) : String(vehicle.odometer))
  const [totalCost, setTotalCost] = useState(log?.total_cost != null ? String(log.total_cost) : '')
  const [pricePerGallon, setPricePerGallon] = useState(log?.price_per_gallon != null ? String(log.price_per_gallon) : '')
  const [gallons, setGallons] = useState(log?.gallons != null ? String(log.gallons) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A stable row id for this modal session so any retry (or re-tap of Save) re-writes
  // the SAME row instead of creating a duplicate — this is what makes auto-retry safe.
  const [rowId] = useState(() => (isEdit ? log!.id : crypto.randomUUID()))

  // Warm the connection the moment the form opens. After a long sleep the browser's
  // saved connection is dead; kicking a throwaway read now lets it reconnect while you
  // fill in the form, so Save is fast — often instant — by the time you tap it.
  useEffect(() => {
    withTimeout(supabase.from('fuel_logs').select('id').eq('vehicle_id', vehicle.id).limit(1), 9000)
      .catch(() => { /* just warming the pipe; ignore the result */ })
  }, [vehicle.id])

  // total = gallons × price. Editing any two auto-fills the third (gallons by default).
  function onTotal(v: string) {
    setTotalCost(v)
    const T = num(v), P = num(pricePerGallon)
    if (T != null && P != null && P > 0) setGallons((T / P).toFixed(3))
  }
  function onPrice(v: string) {
    setPricePerGallon(v)
    const P = num(v), T = num(totalCost), G = num(gallons)
    if (T != null && P != null && P > 0) setGallons((T / P).toFixed(3))
    else if (G != null && P != null) setTotalCost((G * P).toFixed(2))
  }
  function onGallons(v: string) {
    setGallons(v)
    const G = num(v), P = num(pricePerGallon), T = num(totalCost)
    if (G != null && P != null) setTotalCost((G * P).toFixed(2))
    else if (G != null && G > 0 && T != null) setPricePerGallon((T / G).toFixed(3))
  }

  const canSave = !!date && (odometer.trim() !== '' || gallons.trim() !== '' || pricePerGallon.trim() !== '' || totalCost.trim() !== '')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !canSave) return
    setSaving(true)
    setError(null)
    try {
      const odo = odometer.trim() ? parseInt(odometer) : vehicle.odometer

      // Reconcile the three interdependent fields — derive whatever's missing.
      let G = num(gallons), P = num(pricePerGallon), T = num(totalCost)
      if (G == null && T != null && P != null && P > 0) G = T / P
      if (T == null && G != null && P != null) T = G * P
      if (P == null && T != null && G != null && G > 0) P = T / G

      // MPG from the most recent earlier fill-up (only when gallons are known).
      // A read is safe to retry, so retry it too — this is also what reconnects a
      // dead pipe before the write below.
      let mpg: number | null = null
      if (G != null && G > 0) {
        const { data: prev } = await withRetry(() => withTimeout(supabase
          .from('fuel_logs')
          .select('odometer')
          .eq('vehicle_id', vehicle.id)
          .lt('odometer', odo)
          .order('odometer', { ascending: false })
          .limit(1)
          .maybeSingle(), 9000), 2, 800)
        mpg = prev && odo - prev.odometer > 0 ? (odo - prev.odometer) / G : null
      }

      const payload = {
        date,
        odometer: odo,
        gallons: G != null ? parseFloat(G.toFixed(3)) : null,
        price_per_gallon: P != null ? parseFloat(P.toFixed(3)) : null,
        total_cost: T != null ? parseFloat(T.toFixed(2)) : null,
        mpg: mpg != null ? parseFloat(mpg.toFixed(2)) : null,
      }

      // Idempotent write, retried a few times: a first attempt that stalls on a dead
      // pipe fails fast (9s) and the retry lands on a fresh connection. Because every
      // attempt targets the same rowId (upsert on the primary key), retrying can never
      // create a duplicate — so it's safe to just keep trying until it lands.
      const { error: dbErr } = await withRetry(() => withTimeout(isEdit
        ? supabase.from('fuel_logs').update(payload).eq('id', rowId)
        : supabase.from('fuel_logs').upsert({ id: rowId, user_id: user.id, vehicle_id: vehicle.id, ...payload }), 9000), 2, 800)
      if (dbErr) { setError(saveError(dbErr.message)); return }

      if (odo > vehicle.odometer) {
        // Bumping the odometer is idempotent (sets an absolute value), so retry it too.
        await withRetry(() => withTimeout(supabase.from('vehicles').update({ odometer: odo }).eq('id', vehicle.id), 9000), 2, 800)
      }
      // Recompute the MPG chain: this fill-up may sit before an existing one (e.g. a
      // backfilled older entry), whose MPG must now be measured from this one.
      await recomputeFuelMpg(vehicle.id)
      onSaved()
    } catch (e) {
      setError(saveError(e instanceof Error ? e.message : ''))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface-2 border border-border rounded-xl px-3 py-3 text-foreground placeholder-faint focus:outline-none focus:border-accent transition-all'

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-3xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
              <Fuel size={17} className="text-accent" />
            </div>
            <h3 className="font-bold text-foreground">{isEdit ? 'Edit Fillup' : 'Log Fuel'}</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground"><X size={18} /></button>
        </div>

        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">Odometer</label>
            <div className="relative">
              <input type="number" inputMode="numeric" value={odometer} onChange={e => setOdometer(e.target.value)} placeholder="—"
                className={`${inputCls} text-xl font-bold tabular-nums`} />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-faint text-sm">mi</span>
            </div>
          </div>

          {/* Total + Price are the primary entries */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Total cost</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint text-sm">$</span>
                <input type="number" inputMode="decimal" step="0.01" placeholder="—" value={totalCost} onChange={e => onTotal(e.target.value)}
                  className={`${inputCls} pl-6 font-semibold tabular-nums`} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Price / gal</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint text-sm">$</span>
                <input type="number" inputMode="decimal" step="0.001" placeholder="—" value={pricePerGallon} onChange={e => onPrice(e.target.value)}
                  className={`${inputCls} pl-6 font-semibold tabular-nums`} />
              </div>
            </div>
          </div>

          {/* Gallons auto-calculates from the two above (still editable) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Gallons <span className="text-faint font-normal">· auto</span></label>
              <input type="number" inputMode="decimal" step="0.001" placeholder="—" value={gallons} onChange={e => onGallons(e.target.value)}
                className={`${inputCls} font-semibold tabular-nums`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
          </div>

          {error && <p className="text-danger text-sm bg-danger/10 border border-danger/20 rounded-xl px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-3 transition-colors">Cancel</button>
            <button type="submit" disabled={!canSave || saving}
              className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-accent-foreground font-bold rounded-2xl py-3 transition-colors">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="text-faint text-xs text-center">Enter any two of total / price / gallons — the third fills in. All optional.</p>
        </form>
      </div>
    </div>
  )
}
