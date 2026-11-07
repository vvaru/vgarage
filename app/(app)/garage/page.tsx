'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { read, runSave, step } from '@/lib/recover'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { useDataRefresh, useForms } from '@/components/shell/forms'
import PageHeader, { Page } from '@/components/shell/PageHeader'
import { dueText, estimatedOdometer, milesPerMonth, scheduleStatuses } from '@/lib/schedule'
import {
  Avatar, Button, Card, Confirm, EmptyState, IconButton, Pill, Progress, Skeleton, useSnackbar,
} from '@/components/ui/md'
import type { FuelLog, ServiceCategory, ServiceLog, Vehicle } from '@/lib/types'

interface Rows { cats: ServiceCategory[]; services: ServiceLog[]; fuel: FuelLog[] }

export default function CarsPage() {
  const { user } = useAuth()
  const { vehicle: active, vehicles, setActiveVehicleId, refresh } = useVehicle()
  const { open, changed } = useForms()
  const snack = useSnackbar()
  const [rows, setRows] = useState<Rows | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  useDataRefresh(reload)
  const [toDelete, setToDelete] = useState<Vehicle | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = vehicles.map(v => v.id).join(',')

  useEffect(() => {
    if (!user || !ids) return
    let live = true
    const list = ids.split(',')
    Promise.all([
      read(supabase.from('service_categories').select('*').in('vehicle_id', list)),
      read(supabase.from('service_logs').select('*').in('vehicle_id', list).order('date', { ascending: false })),
      read(supabase.from('fuel_logs').select('*').in('vehicle_id', list)),
    ]).then(([cats, services, fuel]) => {
      if (!live) return
      if (cats.error ?? services.error ?? fuel.error) throw new Error((cats.error ?? services.error ?? fuel.error)!.message)
      setRows({ cats: (cats.data ?? []) as ServiceCategory[], services: (services.data ?? []) as ServiceLog[], fuel: (fuel.data ?? []) as FuelLog[] })
      setLoadError(null)
    }).catch(e => { if (live) setLoadError(e instanceof Error ? e.message : 'Couldn’t load your cars.') })
    return () => { live = false }
  }, [user, ids, tick])

  async function setTracking(v: Vehicle, on: boolean) {
    setError(null)
    const res = await runSave(() => step(() => supabase.from('vehicles').update({ track_tire_positions: on }).eq('id', v.id)).then(() => {}))
    if (!res.ok) { setError(res.message); return }
    await refresh()
    changed()
  }

  async function remove() {
    if (!toDelete) return
    setBusy(true); setError(null)
    const res = await runSave(() => step(() => supabase.from('vehicles').delete().eq('id', toDelete.id)).then(() => {}))
    setBusy(false)
    const name = `${toDelete.make} ${toDelete.model}`
    setToDelete(null)
    if (!res.ok) { setError(`${res.message} The car is still there.`); return }
    await refresh()
    changed()
    snack(`${name} deleted`)
  }

  const counts = (v: Vehicle) => ({
    services: rows?.services.filter(l => l.vehicle_id === v.id).length ?? 0,
    fuel: rows?.fuel.filter(l => l.vehicle_id === v.id).length ?? 0,
  })

  return (
    <Page>
      <PageHeader title="Cars" showVehicle={false} subtitle={`${vehicles.length} car${vehicles.length === 1 ? '' : 's'}`}
        actions={<>
          <Button icon="add" className="max-sm:hidden" onClick={() => open({ kind: 'car' })}>Add a car</Button>
          <IconButton icon="add" label="Add a car" className="sm:hidden" onClick={() => open({ kind: 'car' })} />
        </>} />

      {error && <p role="alert" className="type-body text-error mb-4">{error}</p>}

      {vehicles.length === 0 ? (
        <EmptyState icon="directions_car" title="No cars yet" action={<Button icon="add" onClick={() => open({ kind: 'car' })}>Add a car</Button>} />
      ) : !rows ? (
        loadError
          ? <EmptyState icon="cloud_off" title="Couldn’t load your cars" body={loadError} action={<Button onClick={reload}>Try again</Button>} />
          : <div className="grid lg:grid-cols-2 gap-4">{vehicles.map(v => <Skeleton key={v.id} className="h-64" />)}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {vehicles.map(v => {
            const services = rows.services.filter(l => l.vehicle_id === v.id)
            const fuel = rows.fuel.filter(l => l.vehicle_id === v.id)
            const cats = rows.cats.filter(c => c.vehicle_id === v.id && c.is_visible !== false)
            const perMonth = milesPerMonth(services, fuel)
            const { odo } = estimatedOdometer(v.odometer, services, fuel, perMonth)
            const statuses = scheduleStatuses(cats, services, odo)
            const overdue = statuses.filter(s => s.isOverdue)
            const soon = statuses.filter(s => s.isDueSoon)
            const onTrack = statuses.length ? (statuses.length - overdue.length) / statuses.length : 1
            const last = services[0]
            const isActive = v.id === active?.id
            const tracking = v.track_tire_positions !== false
            return (
              <Card key={v.id} variant={isActive ? 'plain' : 'outlined'} className="p-4 sm:p-5 flex flex-col gap-4 min-w-0">
                <div className="flex items-start gap-4">
                  <Avatar icon="directions_car" tone={isActive ? 'primary' : 'neutral'} />
                  <div className="flex-1 min-w-0">
                    <p className="type-title-lg text-on-surface truncate">{v.year} {v.make} {v.model}</p>
                    <p className="type-body text-on-surface-variant truncate">{[v.trim, v.license_plate, v.vin].filter(Boolean).join(' · ') || 'No trim or plate yet'}</p>
                  </div>
                  {isActive
                    ? <Pill tone="info">Active</Pill>
                    : <Button size="sm" variant="tonal" onClick={() => setActiveVehicleId(v.id)}>Switch to</Button>}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <p className="type-label text-on-surface-variant">Odometer{odo > v.odometer ? ' (estimated)' : ''}</p>
                    <p className="type-title-lg text-on-surface tabular-nums">{odo.toLocaleString()} mi</p>
                    <p className="type-body-sm text-on-surface-variant">About {perMonth.toLocaleString()} mi a month</p>
                  </div>
                  <div className="min-w-0">
                    <p className="type-label text-on-surface-variant">Schedule on track</p>
                    <p className="type-title-lg text-on-surface tabular-nums">{Math.round(onTrack * 100)}%</p>
                    <Progress className="mt-1.5" value={onTrack} tone={onTrack >= 0.8 ? 'success' : onTrack >= 0.5 ? 'warn' : 'error'} />
                  </div>
                </div>

                {cats.length === 0 ? (
                  <p className="type-body text-on-surface-variant">No service categories on this car yet. Add them from Service categories while it’s the active car.</p>
                ) : overdue.length + soon.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {overdue.map(s => <Pill key={s.cat.id} tone="due" className="max-w-full"><span className="truncate">{s.cat.name}: {dueText(s).toLowerCase()}</span></Pill>)}
                    {soon.map(s => <Pill key={s.cat.id} tone="soon" className="max-w-full"><span className="truncate">{s.cat.name}: {dueText(s).toLowerCase()}</span></Pill>)}
                  </div>
                ) : (
                  <Pill tone="ok" icon="check_circle" className="self-start">All {statuses.length} services current</Pill>
                )}

                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={tracking} onChange={e => setTracking(v, e.target.checked)} className="mt-1 w-[18px] h-[18px] accent-[var(--md-primary)]" />
                  <span>
                    <span className="block type-body text-on-surface">Track which corner each tire is on</span>
                    <span className="block type-body-sm text-on-surface-variant">{tracking ? 'Rotations are recorded.' : 'Tire miles still count; rotations aren’t recorded.'}</span>
                  </span>
                </label>

                <div className="flex items-center gap-2 flex-wrap">
                  <p className="flex-1 min-w-40 type-body-sm text-on-surface-variant truncate">
                    {last ? `Last service: ${last.service_type}, ${format(parseISO(last.date), 'MMM d, yyyy')}` : 'No services logged yet'}
                  </p>
                  <Button size="sm" variant="text" icon="edit" onClick={() => open({ kind: 'car', car: v })}>Edit</Button>
                  <Button size="sm" variant="danger" icon="delete" onClick={() => setToDelete(v)}>Delete</Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Confirm open={Boolean(toDelete)} title={toDelete ? `Delete the ${toDelete.make} ${toDelete.model}?` : ''} confirmLabel="Delete car" danger busy={busy}
        onCancel={() => setToDelete(null)} onConfirm={remove}
        body={toDelete ? `This permanently deletes the car, its ${counts(toDelete).services} services and its ${counts(toDelete).fuel} fill-ups. It can’t be undone.` : undefined} />
    </Page>
  )
}
