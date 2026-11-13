'use client'

import { useCallback, useEffect, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { read, runSave, step } from '@/lib/recover'
import { useAuth } from '@/components/auth/AuthProvider'
import PageHeader, { Page } from '@/components/shell/PageHeader'
import { addFromCatalog, intervalText, missingFromCatalog } from '@/lib/categories'
import { scheduleStatuses } from '@/lib/schedule'
import {
  Avatar, Button, Card, Dialog, EmptyState, Icon, IconButton, ListItem, Pill, SelectField, Skeleton, Tabs, TextArea, TextField, useSnackbar,
} from '@/components/ui/md'
import type { CategoryRequest, GlobalCategory, ServiceCategory, ServiceLog, UserProfile, Vehicle } from '@/lib/types'

type Tab = 'users' | 'catalog' | 'suggestions'

interface Data {
  users: UserProfile[]
  vehicles: Vehicle[]
  cats: ServiceCategory[]
  logs: ServiceLog[]
  catalog: GlobalCategory[]
  requests: CategoryRequest[]
}

const int = (s: string) => (s.trim() ? parseInt(s) : null)

export default function AdminPage() {
  const { isAdmin, roleReady } = useAuth()
  const router = useRouter()
  const snack = useSnackbar()
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const [tab, setTab] = useState<Tab>('users')
  const [openUser, setOpenUser] = useState<string | null>(null)
  const [editing, setEditing] = useState<GlobalCategory | 'new' | null>(null)
  const [reviewing, setReviewing] = useState<CategoryRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (roleReady && !isAdmin) router.replace('/dashboard')
  }, [roleReady, isAdmin, router])

  useEffect(() => {
    if (!isAdmin) return
    let live = true
    Promise.all([
      read(supabase.from('user_profiles').select('*').order('created_at')),
      read(supabase.from('vehicles').select('*').order('created_at')),
      read(supabase.from('service_categories').select('*').order('name')),
      read(supabase.from('service_logs').select('id,vehicle_id,category_id,date,odometer').order('date', { ascending: false })),
      read(supabase.from('global_categories').select('*').order('name')),
      read(supabase.from('category_requests').select('*').order('created_at', { ascending: false })),
    ]).then(([users, vehicles, cats, logs, catalog, requests]) => {
      if (!live) return
      const failed = users.error ?? vehicles.error ?? cats.error ?? logs.error ?? catalog.error ?? requests.error
      if (failed) throw new Error(failed.message)
      setData({
        users: (users.data ?? []) as UserProfile[],
        vehicles: (vehicles.data ?? []) as Vehicle[],
        cats: (cats.data ?? []) as ServiceCategory[],
        logs: (logs.data ?? []) as ServiceLog[],
        catalog: (catalog.data ?? []) as GlobalCategory[],
        requests: (requests.data ?? []) as CategoryRequest[],
      })
      setLoadError(null)
    }).catch(e => { if (live) setLoadError(e instanceof Error ? e.message : 'Couldn’t load the admin data.') })
    return () => { live = false }
  }, [isAdmin, tick])

  async function act(work: () => Promise<void>, done: string) {
    setBusy(true); setError(null)
    const res = await runSave(work)
    setBusy(false)
    if (!res.ok) { setError(res.message); return false }
    snack(done)
    reload()
    return true
  }

  if (!isAdmin) return null

  const pending = data?.requests.filter(r => r.status === 'pending').length ?? 0
  const carsOf = (id: string) => data!.vehicles.filter(v => v.user_id === id)
  const catsOf = (id: string) => data!.cats.filter(c => c.vehicle_id === id)
  const missingFor = (v: Vehicle) => missingFromCatalog(data!.catalog, catsOf(v.id))
  const overdueFor = (v: Vehicle) => scheduleStatuses(catsOf(v.id).filter(c => c.category_type === 'maintenance'), data!.logs.filter(l => l.vehicle_id === v.id), v.odometer).filter(s => s.isOverdue).length

  const fixCar = (v: Vehicle) => act(() => addFromCatalog(missingFor(v), v.user_id, v.id), `Copied the catalog into the ${v.make} ${v.model}`)
  const setRole = (u: UserProfile, role: string) => act(() => step(() => supabase.from('user_profiles').update({ role }).eq('id', u.id)).then(() => {}), 'Role changed')
  const toggleCat = (c: ServiceCategory) => act(() => step(() => supabase.from('service_categories').update({ is_visible: c.is_visible === false }).eq('id', c.id)).then(() => {}), c.is_visible === false ? `${c.name} shown` : `${c.name} hidden`)
  const toggleEntry = (g: GlobalCategory) => act(() => step(() => supabase.from('global_categories').update({ is_active: !g.is_active }).eq('id', g.id)).then(() => {}), g.is_active ? `${g.name} no longer offered` : `${g.name} offered again`)

  return (
    <Page>
      <PageHeader title="Admin" showVehicle={false}
        subtitle={data ? `${data.users.length} user${data.users.length === 1 ? '' : 's'} · ${data.vehicles.length} car${data.vehicles.length === 1 ? '' : 's'}` : undefined}
        actions={<IconButton icon="refresh" label="Reload" onClick={reload} />} />

      <Tabs className="-mx-4 sm:mx-0 mb-5" value={tab} onChange={setTab}
        tabs={[
          { value: 'users', label: 'Users', icon: 'group' },
          { value: 'catalog', label: 'Catalog', icon: 'category' },
          { value: 'suggestions', label: 'Suggestions', icon: 'lightbulb', badge: pending || undefined },
        ]} />

      {error && <p role="alert" className="type-body text-error mb-4">{error}</p>}

      {!data ? (
        loadError
          ? <EmptyState icon="cloud_off" title="Couldn’t load the admin data" body={loadError} action={<Button onClick={reload}>Try again</Button>} />
          : <div className="grid gap-3 max-w-4xl">{[0, 1, 2].map(i => <Skeleton key={i} className="h-[72px]" />)}</div>
      ) : tab === 'users' ? (
        <div className="flex flex-col gap-3 max-w-4xl">
          {data.users.length === 0 && <EmptyState icon="group" title="No users yet" />}
          {data.users.map(u => {
            const cars = carsOf(u.id)
            const behind = cars.reduce((s, v) => s + missingFor(v).length, 0)
            const empty = cars.some(v => catsOf(v.id).length === 0)
            const isOpen = openUser === u.id
            return (
              <Card key={u.id} variant="outlined" className="overflow-hidden">
                <ListItem onClick={() => setOpenUser(isOpen ? null : u.id)}
                  leading={<Avatar icon="person" tone={u.role === 'admin' ? 'primary' : 'secondary'} />}
                  headline={u.full_name || u.email || 'No name'}
                  supporting={`${u.role === 'admin' ? 'Admin · ' : ''}${cars.length} car${cars.length === 1 ? '' : 's'}${u.full_name && u.email ? ` · ${u.email}` : ''}`}
                  trailing={<>
                    {cars.length > 0 && (empty ? <Pill tone="due">Missing categories</Pill> : behind > 0 ? <Pill tone="soon">{behind} behind</Pill> : <span className="max-sm:hidden"><Pill tone="ok">Up to date</Pill></span>)}
                    <Icon name={isOpen ? 'expand_less' : 'expand_more'} size={24} />
                  </>} />
                {isOpen && (
                  <div className="border-t border-outline-variant p-4 flex flex-col gap-5">
                    <div className="flex flex-wrap items-end gap-4">
                      <SelectField label="Role" className="w-40" value={u.role} disabled={busy} onChange={e => setRole(u, e.target.value)}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </SelectField>
                      <p className="type-body-sm text-on-surface-variant pb-1">Joined {format(parseISO(u.created_at), 'MMM d, yyyy')}</p>
                    </div>
                    {cars.length === 0 && <p className="type-body text-on-surface-variant">No cars yet.</p>}
                    {cars.map(v => {
                      const missing = missingFor(v)
                      const overdue = overdueFor(v)
                      return (
                        <div key={v.id} className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="flex-1 min-w-48 type-title-sm text-on-surface">{v.year} {v.make} {v.model} <span className="type-body text-on-surface-variant">· {v.odometer.toLocaleString()} mi</span></p>
                            {overdue > 0 && <Pill tone="due">{overdue} overdue</Pill>}
                            {missing.length > 0 && <Button size="sm" variant="tonal" loading={busy} onClick={() => fixCar(v)}>Add {missing.length} from the catalog</Button>}
                          </div>
                          {missing.length > 0 && <p className="type-body-sm text-on-surface-variant">Missing: {missing.map(m => m.name).join(', ')}</p>}
                          <div className="flex flex-col gap-1">
                            {catsOf(v.id).map(c => (
                              <label key={c.id} className="flex items-center gap-3 cursor-pointer py-1">
                                <input type="checkbox" checked={c.is_visible !== false} disabled={busy} onChange={() => toggleCat(c)} className="w-[18px] h-[18px] accent-[var(--md-primary)]" />
                                <span className={`flex-1 min-w-0 truncate type-body ${c.is_visible !== false ? 'text-on-surface' : 'text-on-surface-variant line-through'}`}>{c.name}</span>
                                <span className="type-body-sm text-on-surface-variant max-sm:hidden">{intervalText(c)}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      ) : tab === 'catalog' ? (
        <div className="flex flex-col gap-3 max-w-4xl">
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 min-w-52 type-body text-on-surface-variant">The template for new cars. Users are offered new entries and interval changes; nothing overwrites their settings.</p>
            <Button icon="add" onClick={() => setEditing('new')}>Add to catalog</Button>
          </div>
          <Card variant="outlined" className="py-1 overflow-hidden">
            {data.catalog.length === 0 && <EmptyState icon="category" title="The catalog is empty" />}
            {data.catalog.map(g => {
              const have = data.vehicles.filter(v => !missingFromCatalog([{ ...g, is_active: true }], catsOf(v.id)).length).length
              return (
                <ListItem key={g.id} onClick={() => setEditing(g)} headline={g.name}
                  leading={<Avatar icon="build" tone={g.is_active ? 'secondary' : 'neutral'} />}
                  supporting={`${intervalText(g) ?? 'No reminder'} · on ${have} of ${data.vehicles.length} cars`}
                  trailing={g.is_active ? undefined : <Pill>Not offered</Pill>} />
              )
            })}
          </Card>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-w-4xl">
          {data.requests.length === 0 && <EmptyState icon="lightbulb" title="No suggestions yet" />}
          {data.requests.map(r => {
            const from = data.users.find(u => u.id === r.user_id)
            return (
              <Card key={r.id} variant="outlined" className="p-4 flex flex-col gap-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="type-title text-on-surface">{r.name}</p>
                    <p className="type-body-sm text-on-surface-variant">From {from?.full_name || from?.email || 'a user'} · {format(parseISO(r.created_at), 'MMM d, yyyy')}{intervalText(r) ? ` · ${intervalText(r)}` : ''}</p>
                  </div>
                  <Pill tone={r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'due' : 'soon'}>{r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Approved' : 'Declined'}</Pill>
                </div>
                {r.description && <p className="type-body text-on-surface-variant">{r.description}</p>}
                {r.admin_notes && <p className="type-body-sm text-on-surface-variant">Your note: {r.admin_notes}</p>}
                {r.status === 'pending' && <Button size="sm" variant="tonal" className="self-start" onClick={() => setReviewing(r)}>Review</Button>}
              </Card>
            )
          })}
        </div>
      )}

      {editing && (
        <CatalogDialog key={editing === 'new' ? 'new' : editing.id} entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onToggle={editing === 'new' ? undefined : () => { toggleEntry(editing); setEditing(null) }}
          onSaved={m => { setEditing(null); snack(m); reload() }} />
      )}
      {reviewing && (
        <ReviewDialog request={reviewing} onClose={() => setReviewing(null)} onSaved={m => { setReviewing(null); snack(m); reload() }} />
      )}
    </Page>
  )
}

function CatalogDialog({ entry, onClose, onToggle, onSaved }: {
  entry: GlobalCategory | null; onClose: () => void; onToggle?: () => void; onSaved: (message: string) => void
}) {
  const [name, setName] = useState(entry?.name ?? '')
  const [miles, setMiles] = useState(entry?.interval_miles != null ? String(entry.interval_miles) : '')
  const [days, setDays] = useState(entry?.interval_days != null ? String(entry.interval_days) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true); setError(null)
    const payload = { name: name.trim(), interval_miles: int(miles), interval_days: int(days) }
    const res = await runSave(async () => {
      if (entry) await step(() => supabase.from('global_categories').update(payload).eq('id', entry.id))
      else await step(() => supabase.from('global_categories').insert({ ...payload, category_type: 'maintenance', is_active: true }))
    })
    setSaving(false)
    if (!res.ok) { setError(res.message); return }
    onSaved(entry ? 'Catalog updated. Users will be offered the change.' : `${payload.name} added. Users will be offered it.`)
  }

  return (
    <Dialog open onClose={onClose} title={entry ? 'Edit catalog category' : 'Add to catalog'} size="md"
      primary={{ label: 'Save', onClick: save, disabled: !name.trim() || saving, loading: saving }}>
      <div className="flex flex-col gap-5">
        <TextField label="Name" placeholder="e.g. Engine air filter" value={name} onChange={e => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Every" suffix="mi" type="number" inputMode="numeric" value={miles} onChange={e => setMiles(e.target.value)} />
          <TextField label="or every" suffix="days" type="number" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} />
        </div>
        <p className="type-body-sm text-on-surface-variant">Users see this as “new in the catalog”, or as a change they can accept or keep their own.</p>
        {error && <p role="alert" className="type-body text-error">{error}</p>}
        {onToggle && <Button variant="text" className="self-start -ml-2" onClick={onToggle}>{entry?.is_active ? 'Stop offering this' : 'Offer this again'}</Button>}
      </div>
    </Dialog>
  )
}

function ReviewDialog({ request, onClose, onSaved }: { request: CategoryRequest; onClose: () => void; onSaved: (message: string) => void }) {
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(status: 'approved' | 'rejected') {
    setSaving(true); setError(null)
    const res = await runSave(async () => {
      // Catalog first: if it fails, the suggestion is still waiting and can be retried.
      if (status === 'approved') {
        await step(() => supabase.from('global_categories').insert({
          name: request.name, category_type: 'maintenance', interval_miles: request.interval_miles, interval_days: request.interval_days, is_active: true,
        }))
      }
      await step(() => supabase.from('category_requests').update({ status, admin_notes: notes.trim() || null }).eq('id', request.id))
    })
    setSaving(false)
    if (!res.ok) { setError(res.message); return }
    onSaved(status === 'approved' ? `${request.name} added to the catalog and offered to everyone` : 'Suggestion declined')
  }

  return (
    <Dialog open onClose={onClose} title={request.name} subtitle={intervalText(request) ?? undefined} size="md" variant="basic"
      primary={{ label: 'Approve', onClick: () => decide('approved'), disabled: saving, loading: saving }}
      secondary={{ label: 'Decline', onClick: () => decide('rejected') }}>
      <div className="flex flex-col gap-5">
        {request.description && <p className="type-body text-on-surface-variant">{request.description}</p>}
        <TextArea label="Note to the user (optional)" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        <p className="type-body-sm text-on-surface-variant">Approving adds it to the catalog and offers it to every user.</p>
        {error && <p role="alert" className="type-body text-error">{error}</p>}
      </div>
    </Dialog>
  )
}
