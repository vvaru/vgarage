'use client'

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { supabase, ensureFreshSession } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { withRetry, write } from '@/lib/recover'
import { recomputeFuelMpg } from '@/lib/fuelMpg'
import { checkOdometer, odometerProblem } from '@/lib/odometer'
import { useOdometerPoints } from '@/lib/useOdometerPoints'
import { Dialog, TextField } from '@/components/ui/md'
import type { FuelLog, Vehicle } from '@/lib/types'
import { newId } from '@/lib/newId'

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

// Fuel math is Total = Price × Gallons. We track the two most-recently-edited fields
// as the inputs; the remaining one is the computed field — so ANY field can be typed
// and ANY field can auto-fill (not just gallons).
type Field = 'T' | 'P' | 'G'
const FIELDS: Field[] = ['T', 'P', 'G']

export default function FuelForm({ vehicle, log, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const isEdit = !!log

  const [date, setDate] = useState(log?.date ?? format(new Date(), 'yyyy-MM-dd'))
  const [odometer, setOdometer] = useState(log ? String(log.odometer) : String(vehicle.odometer))
  const [totalCost, setTotalCost] = useState(log?.total_cost != null ? String(log.total_cost) : '')
  const [pricePerGallon, setPricePerGallon] = useState(log?.price_per_gallon != null ? String(log.price_per_gallon) : '')
  const [gallons, setGallons] = useState(log?.gallons != null ? String(log.gallons) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The two fields you most recently edited (most-recent first, max 2) — those are
  // the inputs; the third is what auto-fills.
  const [recent, setRecent] = useState<Field[]>([])
  // A stable row id for this modal session so any retry (or re-tap of Save) re-writes
  // the SAME row instead of creating a duplicate — this is what makes auto-retry safe.
  const [rowId] = useState(() => (isEdit ? log!.id : newId()))
  // Readings only go up: warn as soon as this one doesn't fit the entries around its date.
  const odoPoints = useOdometerPoints(vehicle.id)
  const odoWarning = odoPoints && odometer.trim() ? odometerProblem(odoPoints, date, parseInt(odometer), [rowId]) : null

  // Warm the connection the moment the form opens. After a long sleep the browser's
  // saved connection is dead; kicking a throwaway read now lets it reconnect while you
  // fill in the form, so Save is fast — often instant — by the time you tap it.
  useEffect(() => {
    write(supabase.from('fuel_logs').select('id').eq('vehicle_id', vehicle.id).limit(1))
      .catch(() => { /* just warming the pipe; ignore the result */ })
  }, [vehicle.id])

  // Editing any field recomputes whichever of the other two you touched least recently,
  // using Total = Price × Gallons. So typing gallons fills Total/Price just like typing
  // total fills gallons — nothing is hard-wired to "gallons is the output".
  function applyField(field: Field, v: string) {
    const setter = field === 'T' ? setTotalCost : field === 'P' ? setPricePerGallon : setGallons
    setter(v)

    const vals: Record<Field, number | null> = {
      T: field === 'T' ? num(v) : num(totalCost),
      P: field === 'P' ? num(v) : num(pricePerGallon),
      G: field === 'G' ? num(v) : num(gallons),
    }

    // Inputs = the field just edited + the previously most-recent one. With no history
    // yet, keep the natural pair so typing total/price fills gallons and typing gallons
    // fills total.
    let partner = recent.find(f => f !== field)
    if (!partner) {
      const defaultOutput: Field = field === 'G' ? 'T' : 'G'
      partner = FIELDS.find(f => f !== field && f !== defaultOutput)!
    }
    const output = FIELDS.find(f => f !== field && f !== partner)!

    if (output === 'T' && vals.P != null && vals.G != null) setTotalCost((vals.P * vals.G).toFixed(2))
    else if (output === 'P' && vals.T != null && vals.G != null && vals.G > 0) setPricePerGallon((vals.T / vals.G).toFixed(3))
    else if (output === 'G' && vals.T != null && vals.P != null && vals.P > 0) setGallons((vals.T / vals.P).toFixed(3))

    setRecent([field, ...recent.filter(f => f !== field)].slice(0, 2))
  }

  const canSave = !!date && (odometer.trim() !== '' || gallons.trim() !== '' || pricePerGallon.trim() !== '' || totalCost.trim() !== '')

  async function handleSave() {
    if (!user || !canSave) return
    setSaving(true)
    setError(null)
    try {
      // Refresh an expiring token before writing, not implicitly mid-write.
      await ensureFreshSession()

      const odo = odometer.trim() ? parseInt(odometer) : vehicle.odometer

      // Re-checked against fresh data: it has to fit between the entries around this date.
      const odoProblem = await checkOdometer(vehicle.id, date, odo, [rowId])
      if (odoProblem) { setError(odoProblem); return }

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
        const { data: prev } = await withRetry(() => write(supabase
          .from('fuel_logs')
          .select('odometer')
          .eq('vehicle_id', vehicle.id)
          .lt('odometer', odo)
          .order('odometer', { ascending: false })
          .limit(1)
          .maybeSingle()), 2, 2500)
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
      const { error: dbErr } = await withRetry(() => write(isEdit
        ? supabase.from('fuel_logs').update(payload).eq('id', rowId)
        : supabase.from('fuel_logs').upsert({ id: rowId, user_id: user.id, vehicle_id: vehicle.id, ...payload })), 2, 2500)
      if (dbErr) { setError(`Save failed (${dbErr.message}). Your entry is kept — tap Save to try again.`); return }

      if (odo > vehicle.odometer) {
        // Bumping the odometer is idempotent (sets an absolute value), so retry it too.
        await withRetry(() => write(supabase.from('vehicles').update({ odometer: odo }).eq('id', vehicle.id)), 2, 2500)
      }
      // Recompute the MPG chain: this fill-up may sit before an existing one (e.g. a
      // backfilled older entry), whose MPG must now be measured from this one.
      await recomputeFuelMpg(vehicle.id)
      onSaved()
    } catch (e) {
      // Surface the real reason so we can tell a timeout apart from a DB error.
      const reason = e instanceof Error ? e.message : String(e)
      setError(`Couldn’t save (${reason}). Your entry is kept — tap Save to try again.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={isEdit ? 'Edit fill-up' : 'Log fuel'} size="sm"
      primary={{ label: 'Save', onClick: handleSave, disabled: !canSave || saving, loading: saving }}>
      <div className="flex flex-col gap-5">
        <TextField label="Odometer" suffix="mi" type="number" inputMode="numeric" value={odometer} onChange={e => setOdometer(e.target.value)} error={odoWarning ?? undefined} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Total cost" prefix="$" type="number" inputMode="decimal" step="0.01" value={totalCost} onChange={e => applyField('T', e.target.value)} />
          <TextField label="Price / gal" prefix="$" type="number" inputMode="decimal" step="0.001" value={pricePerGallon} onChange={e => applyField('P', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Gallons" type="number" inputMode="decimal" step="0.001" value={gallons} onChange={e => applyField('G', e.target.value)} />
          <TextField label="Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <p className="type-body-sm text-on-surface-variant">Enter any two of total, price and gallons; the third fills in.</p>
        {error && <p role="alert" className="type-body text-error">{error}</p>}
      </div>
    </Dialog>
  )
}
