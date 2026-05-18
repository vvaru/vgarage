'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { DEFAULT_MAINTENANCE_CATEGORIES } from '@/lib/types'

export default function VehicleSetupModal() {
  const { user } = useAuth()
  const { refresh } = useVehicle()
  const [odometer, setOdometer] = useState('')
  const [vin, setVin] = useState('')
  const [plate, setPlate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setLoading(true)
    setError(null)

    const odo = parseInt(odometer)

    const { data: vehicle, error: vErr } = await supabase
      .from('vehicles')
      .insert({
        user_id: user.id,
        make: 'Honda',
        model: 'Civic',
        year: 2022,
        trim: 'Sport',
        odometer: odo,
        vin: vin.trim() || null,
        license_plate: plate.trim() || null,
      })
      .select()
      .single()

    if (vErr || !vehicle) {
      setError(vErr?.message ?? 'Failed to create vehicle')
      setLoading(false)
      return
    }

    await supabase.from('service_categories').insert(
      DEFAULT_MAINTENANCE_CATEGORIES.map(c => ({
        user_id: user.id,
        vehicle_id: vehicle.id,
        name: c.name,
        category_type: 'maintenance',
        interval_miles: c.interval_miles,
        interval_days: c.interval_days,
      }))
    )

    await refresh()
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-zinc-100">Welcome to vGarage</h2>
          <p className="text-zinc-400 text-sm mt-1">Let's set up your 2022 Honda Civic Sport</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">
              Current Odometer (miles) <span className="text-amber-500">*</span>
            </label>
            <input
              type="number"
              placeholder="e.g. 24500"
              value={odometer}
              onChange={e => setOdometer(e.target.value)}
              required
              min="0"
              max="999999"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/30 transition-all text-lg font-semibold"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">VIN (optional)</label>
            <input
              type="text"
              placeholder="17-character VIN"
              value={vin}
              onChange={e => setVin(e.target.value.toUpperCase())}
              maxLength={17}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/30 transition-all font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5">License Plate (optional)</label>
            <input
              type="text"
              placeholder="e.g. ABC 1234"
              value={plate}
              onChange={e => setPlate(e.target.value.toUpperCase())}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500/70 focus:ring-1 focus:ring-amber-500/30 transition-all"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !odometer}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 font-bold rounded-2xl px-4 py-3.5 transition-colors mt-2 shadow-lg shadow-amber-500/20"
          >
            {loading ? 'Setting up…' : 'Get Started'}
          </button>
        </form>
      </div>
    </div>
  )
}
