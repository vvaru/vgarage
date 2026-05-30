'use client'

import { useEffect, useState, useCallback } from 'react'
import { format, differenceInDays, parseISO } from 'date-fns'
import { Car, Plus, Trash2, ChevronRight, Gauge, CircleAlert, CheckCircle2, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import type { Vehicle, ServiceCategory, ServiceLog, FuelLog } from '@/lib/types'

const FALLBACK_MPM = 1250

function calcMilesPerMonth(serviceLogs: ServiceLog[], fuelLogs: FuelLog[]): number {
  const readings = [
    ...serviceLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
    ...fuelLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
  ].sort((a, b) => a.date.localeCompare(b.date))
  if (readings.length < 2) return FALLBACK_MPM
  const oldest = readings[0]
  const newest = readings[readings.length - 1]
  const days = differenceInDays(parseISO(newest.date), parseISO(oldest.date))
  if (days < 30 || newest.odo <= oldest.odo) return FALLBACK_MPM
  return Math.round((newest.odo - oldest.odo) / days * 30)
}

function projectedOdometer(
  baseOdo: number,
  serviceLogs: ServiceLog[],
  fuelLogs: FuelLog[],
  milesPerMonth: number
): number {
  const readings = [
    ...serviceLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
    ...fuelLogs.filter(l => l.odometer > 0).map(l => ({ date: l.date, odo: l.odometer })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  const latest = readings[0]
  if (!latest || milesPerMonth <= 0) return baseOdo
  const daysSince = differenceInDays(new Date(), parseISO(latest.date))
  if (daysSince <= 0) return Math.max(baseOdo, latest.odo)
  return Math.max(baseOdo, latest.odo + Math.round((milesPerMonth / 30) * daysSince))
}

interface VehicleCardData {
  vehicle: Vehicle
  categories: ServiceCategory[]
  serviceLogs: ServiceLog[]
  fuelLogs: FuelLog[]
}

interface ServiceStatus {
  name: string
  isOverdue: boolean
  isDueSoon: boolean
  milesLeft: number | null
  daysLeft: number | null
}

function getServiceStatuses(data: VehicleCardData, currentOdo: number): ServiceStatus[] {
  return data.categories.map(cat => {
    const catLogs = data.serviceLogs
      .filter(l => l.category_id === cat.id && l.odometer > 0)
      .sort((a, b) => b.odometer - a.odometer)
    const last = catLogs[0] ?? null
    const lastOdo = last?.odometer ?? null
    const lastDate = last?.date ?? null

    const nextOdo = lastOdo != null && cat.interval_miles
      ? lastOdo + cat.interval_miles
      : cat.interval_miles ? currentOdo + cat.interval_miles : null

    const nextDate = lastDate != null && cat.interval_days
      ? format(new Date(new Date(lastDate).getTime() + cat.interval_days * 86400000), 'yyyy-MM-dd')
      : cat.interval_days
      ? format(new Date(Date.now() + cat.interval_days * 86400000), 'yyyy-MM-dd')
      : null

    const milesLeft = nextOdo != null ? nextOdo - currentOdo : null
    const daysLeft = nextDate != null ? differenceInDays(parseISO(nextDate), new Date()) : null

    const isOverdue = (milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft < 0)
    const isDueSoon = !isOverdue && (
      (milesLeft != null && milesLeft <= 500) ||
      (daysLeft != null && daysLeft <= 30)
    )

    return { name: cat.name, isOverdue, isDueSoon, milesLeft, daysLeft }
  })
}

export default function GaragePage() {
  const { user } = useAuth()
  const { vehicle: activeVehicle, vehicles, setActiveVehicleId, refresh: refreshVehicles } = useVehicle()
  const [vehicleData, setVehicleData] = useState<Map<string, VehicleCardData>>(new Map())
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const [addForm, setAddForm] = useState({ year: '', make: '', model: '', trim: '', odometer: '' })
  const [addSaving, setAddSaving] = useState(false)

  const load = useCallback(async () => {
    if (!user || vehicles.length === 0) { setLoading(false); return }
    setLoading(true)
    try {
      const vehicleIds = vehicles.map(v => v.id)

      const [{ data: cats }, { data: svcs }, { data: fuels }] = await Promise.all([
        supabase.from('service_categories').select('*').in('vehicle_id', vehicleIds).eq('category_type', 'maintenance'),
        supabase.from('service_logs').select('*').in('vehicle_id', vehicleIds).order('date', { ascending: false }),
        supabase.from('fuel_logs').select('id,date,odometer,vehicle_id').in('vehicle_id', vehicleIds).order('date', { ascending: true }),
      ])

      const map = new Map<string, VehicleCardData>()
      for (const v of vehicles) {
        map.set(v.id, {
          vehicle: v,
          categories: (cats ?? []).filter(c => c.vehicle_id === v.id),
          serviceLogs: (svcs ?? []).filter(l => l.vehicle_id === v.id),
          fuelLogs: (fuels ?? []).filter(l => l.vehicle_id === v.id) as FuelLog[],
        })
      }
      setVehicleData(map)
    } finally {
      setLoading(false)
    }
  }, [user, vehicles])

  useEffect(() => { load() }, [load])

  async function addVehicle() {
    if (!user || !addForm.year || !addForm.make || !addForm.model) return
    const odo = parseInt(addForm.odometer) || 0
    setAddSaving(true)
    const { data } = await supabase.from('vehicles').insert({
      user_id: user.id,
      year: parseInt(addForm.year),
      make: addForm.make.trim(),
      model: addForm.model.trim(),
      trim: addForm.trim.trim() || null,
      odometer: odo,
    }).select().single()
    if (data) {
      await refreshVehicles()
      setActiveVehicleId(data.id)
    }
    setAddForm({ year: '', make: '', model: '', trim: '', odometer: '' })
    setShowAddModal(false)
    setAddSaving(false)
  }

  async function deleteVehicle(vehicleId: string) {
    await supabase.from('vehicles').delete().eq('id', vehicleId)
    setDeleteConfirm(null)
    await refreshVehicles()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="bg-zinc-950 min-h-screen">
      {/* Header */}
      <div className="px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">My Garage</p>
          <h1 className="text-xl font-bold text-zinc-100 mt-0.5">{vehicles.length} Vehicle{vehicles.length !== 1 ? 's' : ''}</h1>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-3 py-2 rounded-xl transition-colors"
        >
          <Plus size={15} /> Add Vehicle
        </button>
      </div>

      <div className="px-4 space-y-3 pb-28">
        {vehicles.length === 0 && (
          <div className="text-center py-16">
            <Car size={48} className="text-zinc-700 mx-auto mb-3" />
            <p className="text-zinc-400 font-medium">No vehicles yet</p>
            <p className="text-zinc-600 text-sm mt-1">Tap "Add Vehicle" to get started</p>
          </div>
        )}

        {vehicles.map(v => {
          const data = vehicleData.get(v.id)
          if (!data) return null
          const mpm = calcMilesPerMonth(data.serviceLogs, data.fuelLogs)
          const estOdo = projectedOdometer(v.odometer, data.serviceLogs, data.fuelLogs, mpm)
          const isProjected = estOdo > v.odometer
          const statuses = getServiceStatuses(data, estOdo)
          const overdue = statuses.filter(s => s.isOverdue)
          const dueSoon = statuses.filter(s => !s.isOverdue && s.isDueSoon)
          const ok = statuses.filter(s => !s.isOverdue && !s.isDueSoon)
          const isActive = v.id === activeVehicle?.id

          const healthScore = statuses.length
            ? Math.max(0, Math.round(((statuses.length - overdue.length) / statuses.length) * 100))
            : 100
          const healthColor = healthScore >= 80 ? 'text-green-400' : healthScore >= 50 ? 'text-blue-400' : 'text-red-400'
          const healthLabel = healthScore >= 80 ? 'Good' : healthScore >= 50 ? 'Fair' : 'Needs Attention'

          const lastService = data.serviceLogs[0] ?? null

          return (
            <div
              key={v.id}
              className={`bg-zinc-900 border rounded-2xl overflow-hidden transition-all ${
                isActive ? 'border-blue-500/50' : 'border-zinc-800'
              }`}
            >
              {/* Card header */}
              <button
                className="w-full flex items-start gap-3 p-4 text-left"
                onClick={() => setActiveVehicleId(v.id)}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  isActive ? 'bg-blue-500/15' : 'bg-zinc-800'
                }`}>
                  <Car size={20} className={isActive ? 'text-blue-500' : 'text-zinc-500'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-zinc-100 font-bold text-base">{v.year} {v.make} {v.model}</p>
                    {isActive && (
                      <span className="text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-lg">
                        Active
                      </span>
                    )}
                  </div>
                  {v.trim && <p className="text-zinc-500 text-xs mt-0.5">{v.trim}</p>}
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Gauge size={13} className="text-zinc-600" />
                      <span className="text-zinc-300 text-sm font-semibold tabular-nums">{estOdo.toLocaleString()}</span>
                      <span className="text-zinc-600 text-xs">mi</span>
                      {isProjected && (
                        <span className="text-xs text-blue-500/70 font-medium bg-blue-500/10 px-1.5 py-0.5 rounded-md">est</span>
                      )}
                    </div>
                    {mpm !== FALLBACK_MPM && (
                      <span className="text-zinc-700 text-xs">{mpm.toLocaleString()} mi/mo</span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <span className={`text-sm font-bold ${healthColor}`}>{healthScore}%</span>
                  <span className={`text-xs ${healthColor}`}>{healthLabel}</span>
                </div>
              </button>

              {/* Status rows */}
              {statuses.length > 0 && (
                <div className="border-t border-zinc-800 px-4 py-3 space-y-2">
                  {overdue.length > 0 && (
                    <div className="flex items-start gap-2">
                      <CircleAlert size={14} className="text-red-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-red-400 text-xs font-medium mb-1">Overdue ({overdue.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {overdue.map(s => (
                            <span key={s.name} className="text-xs bg-red-500/10 text-red-300 border border-red-500/20 rounded-lg px-2 py-0.5">
                              {s.name}
                              {s.milesLeft != null && s.milesLeft < 0 && (
                                <span className="text-red-500/70 ml-1">{Math.abs(s.milesLeft).toLocaleString()} mi over</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {dueSoon.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Clock size={14} className="text-blue-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-blue-400 text-xs font-medium mb-1">Due Soon ({dueSoon.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {dueSoon.map(s => (
                            <span key={s.name} className="text-xs bg-blue-500/10 text-blue-300 border border-blue-500/20 rounded-lg px-2 py-0.5">
                              {s.name}
                              {s.milesLeft != null && s.milesLeft > 0 && (
                                <span className="text-blue-600/70 ml-1">{s.milesLeft.toLocaleString()} mi</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {ok.length > 0 && overdue.length === 0 && dueSoon.length === 0 && (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                      <p className="text-green-400 text-xs font-medium">All {ok.length} services current</p>
                    </div>
                  )}
                  {ok.length > 0 && (overdue.length > 0 || dueSoon.length > 0) && (
                    <p className="text-zinc-600 text-xs pl-5">{ok.length} service{ok.length !== 1 ? 's' : ''} current</p>
                  )}
                </div>
              )}

              {/* Last service + delete */}
              <div className="border-t border-zinc-800 px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  {lastService ? (
                    <>
                      <p className="text-zinc-600 text-xs">Last service</p>
                      <p className="text-zinc-400 text-xs mt-0.5">
                        {lastService.service_type} · {format(parseISO(lastService.date), 'MMM d, yyyy')}
                      </p>
                    </>
                  ) : (
                    <p className="text-zinc-700 text-xs">No service records</p>
                  )}
                </div>
                <button
                  onClick={() => setDeleteConfirm(v.id)}
                  className="ml-3 p-2 text-zinc-700 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Add Vehicle Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-zinc-100 text-lg">Add Vehicle</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Year *</label>
                <input
                  type="number"
                  placeholder="2020"
                  value={addForm.year}
                  onChange={e => setAddForm(f => ({ ...f, year: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-blue-500/70 transition-all"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Make *</label>
                <input
                  type="text"
                  placeholder="Nissan"
                  value={addForm.make}
                  onChange={e => setAddForm(f => ({ ...f, make: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-blue-500/70 transition-all"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Model *</label>
                <input
                  type="text"
                  placeholder="Rogue"
                  value={addForm.model}
                  onChange={e => setAddForm(f => ({ ...f, model: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-blue-500/70 transition-all"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">Trim</label>
                <input
                  type="text"
                  placeholder="SV"
                  value={addForm.trim}
                  onChange={e => setAddForm(f => ({ ...f, trim: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-blue-500/70 transition-all"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Current Odometer (miles)</label>
              <input
                type="number"
                placeholder="50000"
                value={addForm.odometer}
                onChange={e => setAddForm(f => ({ ...f, odometer: e.target.value }))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-zinc-100 text-sm focus:outline-none focus:border-blue-500/70 transition-all"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addVehicle}
                disabled={addSaving || !addForm.year || !addForm.make || !addForm.model}
                className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors"
              >
                {addSaving ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-zinc-100 text-lg mb-2">Delete Vehicle?</h3>
            <p className="text-zinc-400 text-sm mb-5">
              This will permanently delete the vehicle and all its service and fuel records. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium rounded-2xl py-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteVehicle(deleteConfirm)}
                className="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold rounded-2xl py-3 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
