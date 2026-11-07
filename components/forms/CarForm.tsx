'use client'

import { useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { runSave, step } from '@/lib/recover'
import { seedCar } from '@/lib/categories'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { Dialog, SelectField, TextField } from '@/components/ui/md'
import type { Vehicle } from '@/lib/types'
import { newId } from '@/lib/newId'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: CURRENT_YEAR - 1979 }, (_, i) => CURRENT_YEAR - i)

// Add a car, edit one, or (`setup`) the first-run form that can't be dismissed. A new
// car always gets the catalog's categories, and says so if that didn't work.
export default function CarForm({ car, setup, onClose, onSaved }: {
  car?: Vehicle | null
  setup?: boolean
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { user } = useAuth()
  const { refresh, setActiveVehicleId } = useVehicle()
  const [year, setYear] = useState(String(car?.year ?? CURRENT_YEAR))
  const [make, setMake] = useState(car?.make ?? '')
  const [model, setModel] = useState(car?.model ?? '')
  const [trim, setTrim] = useState(car?.trim ?? '')
  const [odometer, setOdometer] = useState(car ? String(car.odometer) : '')
  const [vin, setVin] = useState(car?.vin ?? '')
  const [plate, setPlate] = useState(car?.license_plate ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Stable id: a retry re-writes the same car instead of adding a second one.
  const draftId = useRef(newId())

  const askOdometer = !car || setup
  const odo = parseInt(odometer)
  const valid = make.trim() && model.trim() && (!askOdometer || odo >= 0)

  async function save() {
    if (!user || !valid) return
    setSaving(true); setError(null)
    const details = {
      year: parseInt(year),
      make: make.trim(),
      model: model.trim(),
      trim: trim.trim() || null,
      vin: vin.trim() || null,
      license_plate: plate.trim() || null,
      details_confirmed: true,
      ...(askOdometer ? { odometer: odo } : {}),
    }
    let message = 'Car updated'
    const res = await runSave(async () => {
      if (car) {
        await step(() => supabase.from('vehicles').update(details).eq('id', car.id))
        return
      }
      await step(() => supabase.from('vehicles').upsert({ id: draftId.current, user_id: user.id, ...details }))
      const count = await seedCar(user.id, draftId.current)
      message = `${details.make} ${details.model} added with ${count} service categories`
    })
    setSaving(false)
    if (!res.ok) {
      setError(car ? res.message : `${res.message} If the car saved, trying again only adds what’s missing.`)
      return
    }
    await refresh()
    if (!car) setActiveVehicleId(draftId.current)
    onSaved(message)
  }

  const confirming = setup && car
  return (
    <Dialog open onClose={onClose} dismissible={!setup} size="md"
      title={confirming ? 'Confirm your car' : setup ? 'Welcome to vGarage' : car ? 'Edit car' : 'Add a car'}
      subtitle={confirming ? 'Check these details and fix anything that’s off.' : setup ? 'Tell us about your car to get started.' : undefined}
      primary={{ label: setup ? (confirming ? 'Confirm' : 'Get started') : 'Save', onClick: save, disabled: !valid || saving, loading: saving }}>
      <div className="flex flex-col gap-5">
        <SelectField label="Year" value={year} onChange={e => setYear(e.target.value)}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </SelectField>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Make" placeholder="e.g. Honda" value={make} onChange={e => setMake(e.target.value)} />
          <TextField label="Model" placeholder="e.g. Civic" value={model} onChange={e => setModel(e.target.value)} />
        </div>
        <TextField label="Trim (optional)" placeholder="e.g. EX" value={trim} onChange={e => setTrim(e.target.value)} />
        {askOdometer && (
          <TextField label="Odometer" suffix="mi" type="number" inputMode="numeric" min={0} value={odometer} onChange={e => setOdometer(e.target.value)} />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField label="VIN (optional)" maxLength={17} value={vin} onChange={e => setVin(e.target.value.toUpperCase())} />
          <TextField label="License plate (optional)" value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} />
        </div>
        {!car && <p className="type-body-sm text-on-surface-variant">Your service categories are set up from the catalog when you save.</p>}
        {error && <p role="alert" className="type-body text-error">{error}</p>}
      </div>
    </Dialog>
  )
}
