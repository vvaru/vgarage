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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <div className="max-w-6xl 2xl:max-w-7xl mx-auto px-4 lg:px-8 pt-10 lg:pt-8 pb-4 flex items-center justify-between">
        <div>
          <p className="text-muted text-xs font-medium uppercase tracking-widest">My Garage</p>
          <h1 className="text-xl lg:text-2xl font-bold text-foreground mt-0.5">{vehicles.length} Vehicle{vehicles.length !== 1 ? 's' : ''}</h1>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-bold px-3 py-2 rounded-xl transition-colors"
        >
          <Plus size={15} /> Add Vehicle
        </button>
      </div>

      <div className="max-w-6xl 2xl:max-w-7xl mx-auto px-4 lg:px-8 grid lg:grid-cols-2 gap-3 pb-28 lg:pb-12 items-start">
        {vehicles.length === 0 && (
          <div className="text-center py-16 lg:col-span-2">
            <Car size={48} className="text-faint mx-auto mb-3" />
            <p className="text-muted font-medium">No vehicles yet</p>
            <p className="text-faint text-sm mt-1">Tap "Add Vehicle" to get started</p>
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
          const healthColor = healthScore >= 80 ? 'text-success' : healthScore >= 50 ? 'text-accent' : 'text-danger'
          const healthLabel = healthScore >= 80 ? 'Good' : healthScore >= 50 ? 'Fair' : 'Needs Attention'

          const lastService = data.serviceLogs[0] ?? null

          return (
            <div
              key={v.id}
              className={`bg-surface border rounded-2xl overflow-hidden transition-all ${
                isActive ? 'border-accent/50' : 'border-border'
              }`}
            >
              {/* Card header */}
              <button
                className="w-full flex items-start gap-3 p-4 text-left"
                onClick={() => setActiveVehicleId(v.id)}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  isActive ? 'bg-accent/15' : 'bg-surface-2'
                }`}>
                  <Car size={20} className={isActive ? 'text-accent' : 'text-muted'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-foreground font-bold text-base">{v.year} {v.make} {v.model}</p>
                    {isActive && (
                      <span className="text-xs font-medium bg-accent/10 text-accent border border-accent/20 px-2 py-0.5 rounded-lg">
                        Active
                      </span>
                    )}
                  </div>
                  {v.trim && <p className="text-muted text-xs mt-0.5">{v.trim}</p>}
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <Gauge size={13} className="text-faint" />
                      <span className="text-foreground text-sm font-semibold tabular-nums">{estOdo.toLocaleString()}</span>
                      <span className="text-faint text-xs">mi</span>
                      {isProjected && (
                        <span className="text-xs text-accent/70 font-medium bg-accent/10 px-1.5 py-0.5 rounded-md">est</span>
                      )}
                    </div>
                    {mpm !== FALLBACK_MPM && (
                      <span className="text-faint text-xs">{mpm.toLocaleString()} mi/mo</span>
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
                <div className="border-t border-border px-4 py-3 space-y-2">
                  {overdue.length > 0 && (
                    <div className="flex items-start gap-2">
                      <CircleAlert size={14} className="text-danger mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-danger text-xs font-medium mb-1">Overdue ({overdue.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {overdue.map(s => (
                            <span key={s.name} className="text-xs bg-danger/10 text-danger border border-danger/20 rounded-lg px-2 py-0.5">
                              {s.name}
                              {s.milesLeft != null && s.milesLeft < 0 && (
                                <span className="text-danger/70 ml-1">{Math.abs(s.milesLeft).toLocaleString()} mi over</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {dueSoon.length > 0 && (
                    <div className="flex items-start gap-2">
                      <Clock size={14} className="text-accent mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-accent text-xs font-medium mb-1">Due Soon ({dueSoon.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {dueSoon.map(s => (
                            <span key={s.name} className="text-xs bg-accent/10 text-accent border border-accent/20 rounded-lg px-2 py-0.5">
                              {s.name}
                              {s.milesLeft != null && s.milesLeft > 0 && (
                                <span className="text-accent/70 ml-1">{s.milesLeft.toLocaleString()} mi</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {ok.length > 0 && overdue.length === 0 && dueSoon.length === 0 && (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-success shrink-0" />
                      <p className="text-success text-xs font-medium">All {ok.length} services current</p>
                    </div>
                  )}
                  {ok.length > 0 && (overdue.length > 0 || dueSoon.length > 0) && (
                    <p className="text-faint text-xs pl-5">{ok.length} service{ok.length !== 1 ? 's' : ''} current</p>
                  )}
                </div>
              )}

              {/* Last service + delete */}
              <div className="border-t border-border px-4 py-3 flex items-center justify-between">
                <div className="min-w-0">
                  {lastService ? (
                    <>
                      <p className="text-faint text-xs">Last service</p>
                      <p className="text-muted text-xs mt-0.5">
                        {lastService.service_type} · {format(parseISO(lastService.date), 'MMM d, yyyy')}
                      </p>
                    </>
                  ) : (
                    <p className="text-faint text-xs">No service records</p>
                  )}
                </div>
                <button
                  onClick={() => setDeleteConfirm(v.id)}
                  className="ml-3 p-2 text-faint hover:text-danger transition-colors rounded-lg hover:bg-danger/10"
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
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-bold text-foreground text-lg">Add Vehicle</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted mb-1 block">Year *</label>
                <input
                  type="number"
                  placeholder="2020"
                  value={addForm.year}
                  onChange={e => setAddForm(f => ({ ...f, year: e.target.value }))}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Make *</label>
                <input
                  type="text"
                  placeholder="Nissan"
                  value={addForm.make}
                  onChange={e => setAddForm(f => ({ ...f, make: e.target.value }))}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Model *</label>
                <input
                  type="text"
                  placeholder="Rogue"
                  value={addForm.model}
                  onChange={e => setAddForm(f => ({ ...f, model: e.target.value }))}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Trim</label>
                <input
                  type="text"
                  placeholder="SV"
                  value={addForm.trim}
                  onChange={e => setAddForm(f => ({ ...f, trim: e.target.value }))}
                  className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Current Odometer (miles)</label>
              <input
                type="number"
                placeholder="50000"
                value={addForm.odometer}
                onChange={e => setAddForm(f => ({ ...f, odometer: e.target.value }))}
                className="w-full bg-surface-2 border border-border-strong rounded-xl px-3 py-2.5 text-foreground text-sm focus:outline-none focus:border-accent/70 transition-all"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addVehicle}
                disabled={addSaving || !addForm.year || !addForm.make || !addForm.model}
                className="flex-1 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white font-bold rounded-2xl py-3 transition-colors"
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
          <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-foreground text-lg mb-2">Delete Vehicle?</h3>
            <p className="text-muted text-sm mb-5">
              This will permanently delete the vehicle and all its service and fuel records. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 bg-surface-2 hover:bg-surface-2 text-foreground font-medium rounded-2xl py-3 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteVehicle(deleteConfirm)}
                className="flex-1 bg-danger hover:bg-danger text-white font-bold rounded-2xl py-3 transition-colors"
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
