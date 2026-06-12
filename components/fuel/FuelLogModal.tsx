'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { X, Fuel } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
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

      // MPG from the most recent earlier fill-up (only when gallons are known)
      let mpg: number | null = null
      if (G != null && G > 0) {
        const { data: prev } = await supabase
          .from('fuel_logs')
          .select('odometer')
          .eq('vehicle_id', vehicle.id)
          .lt('odometer', odo)
          .order('odometer', { ascending: false })
          .limit(1)
          .maybeSingle()
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

      const { error: dbErr } = isEdit
        ? await supabase.from('fuel_logs').update(payload).eq('id', log!.id)
        : await supabase.from('fuel_logs').insert({ user_id: user.id, vehicle_id: vehicle.id, ...payload })
      if (dbErr) { setError(dbErr.message); return }

      if (odo > vehicle.odometer) {
        await supabase.from('vehicles').update({ odometer: odo }).eq('id', vehicle.id)
      }
      onSaved()
    } catch {
      setError('Something went wrong. Please try again.')
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
