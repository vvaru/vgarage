'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: CURRENT_YEAR - 1979 }, (_, i) => CURRENT_YEAR - i)

export default function VehicleSetupModal() {
  const { user } = useAuth()
  const { vehicle, refresh } = useVehicle()

  const isConfirmMode = vehicle !== null && vehicle.details_confirmed === false

  const [year, setYear]       = useState(String(isConfirmMode ? vehicle.year : CURRENT_YEAR))
  const [make, setMake]       = useState(isConfirmMode ? vehicle.make : '')
  const [model, setModel]     = useState(isConfirmMode ? vehicle.model : '')
  const [trim, setTrim]       = useState(isConfirmMode ? (vehicle.trim ?? '') : '')
  const [odometer, setOdo]    = useState(isConfirmMode ? String(vehicle.odometer) : '')
  const [vin, setVin]         = useState(isConfirmMode ? (vehicle.vin ?? '') : '')
  const [plate, setPlate]     = useState(isConfirmMode ? (vehicle.license_plate ?? '') : '')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setLoading(true)
    setError(null)

    try {
    const odo = parseInt(odometer)
    const payload = {
      user_id: user.id,
      make: make.trim(),
      model: model.trim(),
      year: parseInt(year),
      trim: trim.trim() || null,
      odometer: odo,
      vin: vin.trim() || null,
      license_plate: plate.trim() || null,
      details_confirmed: true,
    }

    if (isConfirmMode) {
      const { error: uErr } = await supabase
        .from('vehicles')
        .update(payload)
        .eq('id', vehicle.id)

      if (uErr) {
        setError(uErr.message)
        return
      }
    } else {
      const { data: newVehicle, error: vErr } = await supabase
        .from('vehicles')
        .insert(payload)
        .select()
        .single()

      if (vErr || !newVehicle) {
        setError(vErr?.message ?? 'Failed to create vehicle')
        return
      }

      // Seed categories from global templates; fall back to hardcoded defaults
      const { data: globalCats } = await supabase
        .from('global_categories')
        .select('*')
        .eq('is_active', true)
        .order('name')

      const source = globalCats && globalCats.length > 0
        ? globalCats.map(gc => ({
            user_id: user.id,
            vehicle_id: newVehicle.id,
            name: gc.name,
            category_type: gc.category_type as 'maintenance',
            interval_miles: gc.interval_miles,
            interval_days: gc.interval_days,
            global_category_id: gc.id,
          }))
        : [
            { name: 'Oil Change',        interval_miles: 5000,  interval_days: 180  },
            { name: 'CVT Fluid',         interval_miles: 30000, interval_days: 1095 },
            { name: 'Spark Plugs',       interval_miles: 60000, interval_days: 2190 },
            { name: 'Tire Rotation',     interval_miles: 5000,  interval_days: 180  },
            { name: 'Brake Inspection',  interval_miles: 20000, interval_days: 730  },
            { name: 'Air Filter',        interval_miles: 20000, interval_days: 730  },
            { name: 'Cabin Filter',      interval_miles: 15000, interval_days: 540  },
          ].map(c => ({
            user_id: user.id,
            vehicle_id: newVehicle.id,
            name: c.name,
            category_type: 'maintenance' as const,
            interval_miles: c.interval_miles,
            interval_days: c.interval_days,
            global_category_id: null,
          }))

      await supabase.from('service_categories').insert(source)
    }

    await refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
            </svg>
          </div>
          {isConfirmMode ? (
            <>
              <h2 className="text-xl font-bold text-zinc-100">Confirm your vehicle</h2>
              <p className="text-zinc-400 text-sm mt-1">We need to verify your car details — please update below.</p>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold text-zinc-100">Welcome to vGarage</h2>
              <p className="text-zinc-400 text-sm mt-1">Tell us about your car to get started.</p>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Year */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Year <span className="text-blue-500">*</span></label>
            <select
              value={year}
              onChange={e => setYear(e.target.value)}
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 focus:outline-none focus:border-blue-500/70 transition-all"
            >
              {YEARS.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          {/* Make */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Make <span className="text-blue-500">*</span></label>
            <input
              type="text"
              placeholder="e.g. Honda"
              value={make}
              onChange={e => setMake(e.target.value)}
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Model <span className="text-blue-500">*</span></label>
            <input
              type="text"
              placeholder="e.g. Civic"
              value={model}
              onChange={e => setModel(e.target.value)}
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all"
            />
          </div>

          {/* Trim */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">Trim (optional)</label>
            <input
              type="text"
              placeholder="e.g. Sport, EX, LX"
              value={trim}
              onChange={e => setTrim(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all"
            />
          </div>

          {/* Odometer */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">
              Current Odometer (miles) <span className="text-blue-500">*</span>
            </label>
            <input
              type="number"
              placeholder="e.g. 24500"
              value={odometer}
              onChange={e => setOdo(e.target.value)}
              required
              min="0"
              max="999999"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all text-lg font-semibold"
            />
          </div>

          {/* VIN */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">VIN (optional)</label>
            <input
              type="text"
              placeholder="17-character VIN"
              value={vin}
              onChange={e => setVin(e.target.value.toUpperCase())}
              maxLength={17}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all font-mono text-sm"
            />
          </div>

          {/* License plate */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">License Plate (optional)</label>
            <input
              type="text"
              placeholder="e.g. ABC 1234"
              value={plate}
              onChange={e => setPlate(e.target.value.toUpperCase())}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500/70 transition-all"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !make.trim() || !model.trim() || !odometer}
            className="w-full bg-blue-500 hover:bg-blue-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold rounded-2xl px-4 py-3.5 transition-colors mt-2 shadow-lg shadow-blue-500/20"
          >
            {loading ? (isConfirmMode ? 'Updating…' : 'Setting up…') : (isConfirmMode ? 'Confirm Details' : 'Get Started')}
          </button>
        </form>
      </div>
    </div>
  )
}
