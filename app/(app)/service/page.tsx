'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { differenceInDays, format, parseISO, subMonths, subYears } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { runSave, step, write } from '@/lib/recover'
import { useAuth } from '@/components/auth/AuthProvider'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { useForms } from '@/components/shell/forms'
import PageHeader, { Page } from '@/components/shell/PageHeader'
import {
  Avatar, Button, Card, Chip, Dialog, EmptyState, Icon, IconButton, ListItem, Menu, Pill, Progress,
  SelectField, Skeleton, Tabs, useSnackbar,
} from '@/components/ui/md'
import CarHealthMap from '@/components/service/CarHealthMap'
import CarHealthPanel from '@/components/service/CarHealthPanel'
import { useCarData } from '@/lib/useCarData'
import { useServiceExtras } from '@/lib/useServiceExtras'
import { useIsDesktop } from '@/lib/useMedia'
import { milesPerMonth, estimatedOdometer, scheduleStatuses, dueText, type CategoryStatus } from '@/lib/schedule'
import { allTireLives, mountedByPosition, setHealth, setView, worstMounted, type TireLife, type TirePosition } from '@/lib/tires'
import { componentOf, zoneStates, type ZoneId, type ZoneItem, type ZoneLevel } from '@/lib/carZones'
import { fmtQty } from '@/lib/units'
import { diySaving } from '@/lib/serviceFilter'
import type { ServiceLog } from '@/lib/types'

const ExportPdfModal = dynamic(() => import('@/components/service/ExportPdfModal'), { ssr: false })
const CarfaxImportModal = dynamic(() => import('@/components/service/CarfaxImportModal'), { ssr: false })
const CategoryManagerModal = dynamic(() => import('@/components/service/CategoryManagerModal'), { ssr: false })
const ReceiptViewer = dynamic(() => import('@/components/ui/ReceiptViewer'), { ssr: false })

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const mi = (n: number) => `${Math.round(n).toLocaleString()} mi`
const day = (d: string, f = 'MMM d, yyyy') => format(parseISO(d), f)

type Tab = 'schedule' | 'history'
type Period = 'all' | 'year' | '6mo' | '3mo'
interface Group { key: string; date: string; logs: ServiceLog[]; total: number | null }

function groupByDate(logs: ServiceLog[]): Group[] {
  const map = new Map<string, ServiceLog[]>()
  for (const l of logs) map.set(l.date, [...(map.get(l.date) ?? []), l])
  return [...map].map(([date, items]) => ({
    key: date, date, logs: items,
    total: items.some(l => l.cost != null) ? items.reduce((s, l) => s + Number(l.cost ?? 0), 0) : null,
  })).sort((a, b) => b.date.localeCompare(a.date))
}

export default function ServicesPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { vehicle } = useVehicle()
  const { open } = useForms()
  const snack = useSnackbar()
  const { categories, services, fuel, catalog, loading, error, reload } = useCarData(vehicle?.id)
  const extras = useServiceExtras(user?.id, vehicle?.id)
  const desktop = useIsDesktop()

  const [tab, setTab] = useState<Tab>('schedule')
  const [period, setPeriod] = useState<Period>('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [catOpen, setCatOpen] = useState<string | null>(null)
  const [modal, setModal] = useState<'export' | 'carfax' | 'categories' | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [extraOf, setExtraOf] = useState<ServiceLog[] | null>(null)
  const [merge, setMerge] = useState<{ dupes: ServiceLog[]; notes: string; conflicts: { field: string; label: string; values: string[]; chosen: string }[] } | null>(null)
  const [busy, setBusy] = useState(false)

  // Deep link (/service?log=<id>, from Home's Recent list): open that service's day.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('log')
    if (!id || !services.length) return
    const log = services.find(l => l.id === id)
    if (!log) return
    const t = setTimeout(() => { setTab('history'); setGroupKey(log.date) }, 0)
    router.replace('/service')
    return () => clearTimeout(t)
  }, [services, router])

  const d = useMemo(() => {
    if (!vehicle) return null
    const perMonth = milesPerMonth(services, fuel)
    const est = estimatedOdometer(vehicle.odometer, services, fuel, perMonth).odo
    const maintenance = categories.filter(c => c.category_type === 'maintenance')
    const statuses = scheduleStatuses(maintenance, services, est)
    const unscheduled = maintenance.filter(c => c.interval_miles == null && c.interval_days == null)
    const lives = allTireLives(extras.tires, extras.tireEvents, est)
    const worst = worstMounted(lives)
    const tireHealth = setHealth(lives)
    const tireLevel = (l: TireLife): Exclude<ZoneLevel, 'none'> => l.status === 'over' ? 'due' : l.status === 'due' ? 'soon' : 'ok'
    // An inspection coming due is yellow; only an overdue service goes red.
    const level = (s: CategoryStatus): Exclude<ZoneLevel, 'none'> =>
      s.cat.sub_type === 'check' ? (s.isOverdue || s.isDueSoon ? 'soon' : 'ok') : s.isOverdue ? 'due' : s.isDueSoon ? 'soon' : 'ok'
    const zoneItems: (ZoneItem & { zone: ZoneId })[] = [
      ...statuses.map(s => ({ id: s.cat.id, name: s.cat.name, level: level(s), detail: dueText(s), zone: componentOf(s.cat) })),
      ...(worst ? [{ id: 'tires:life', name: 'Tire life', level: tireLevel(worst), zone: 'tires' as const,
        detail: tireHealth.pctLeft != null ? `${Math.round(tireHealth.pctLeft)}% left on the worst tire` : `${tireHealth.mounted} fitted` }] : []),
    ]
    const set = setView(lives)
    const corners: Map<TirePosition, ZoneLevel> | null = set.shape === 'mixed'
      ? new Map([...mountedByPosition(lives)].map(([pos, l]) => [pos, tireLevel(l)])) : null
    const known = new Set(categories.map(c => c.name))
    const uncategorised = [...new Set(services.filter(s => !s.category_id && !known.has(s.service_type)).map(s => s.service_type))]
    const unlinked = categories.filter(c => services.some(s => s.service_type === c.name && !s.category_id))
    return { est, statuses, unscheduled, zones: zoneStates(zoneItems), corners, uncategorised, unlinked, onTrack: statuses.length ? statuses.filter(s => !s.isOverdue).length / statuses.length : 1 }
  }, [vehicle, categories, services, fuel, extras.tires, extras.tireEvents])

  if (!vehicle || !d) return null

  // ── History filtering ───────────────────────────────────────────────────
  const cutoff = period === 'year' ? subYears(new Date(), 1) : period === '6mo' ? subMonths(new Date(), 6) : period === '3mo' ? subMonths(new Date(), 3) : null
  const filtered = services.filter(s => (!cutoff || parseISO(s.date) >= cutoff) && (!typeFilter || s.service_type === typeFilter))
  const groups = groupByDate(filtered)
  const spent = filtered.reduce((s, l) => s + Number(l.cost ?? 0), 0)
  const saved = filtered.reduce((s, l) => s + (diySaving(l) ?? 0), 0)
  const types = [...new Set(services.map(s => s.service_type))].sort()
  const selected = groupKey ? groupByDate(services).find(g => g.key === groupKey) ?? null : null

  // ── Actions ─────────────────────────────────────────────────────────────
  async function addAsCategory(name: string) {
    if (!vehicle || !user) return
    setBusy(true)
    const res = await runSave(async () => {
      const { data: cat } = await step(() => supabase.from('service_categories').insert({
        user_id: user.id, vehicle_id: vehicle.id, name, category_type: 'maintenance',
        sub_type: /check|inspection/i.test(name) ? 'check' : 'service', component: componentOf({ name }),
      }).select('id').single())
      if (!cat) throw new Error('the category was not created')
      await step(() => supabase.from('service_logs').update({ category_id: cat.id }).eq('vehicle_id', vehicle.id).eq('service_type', name))
    })
    setBusy(false)
    snack(res.ok ? `“${name}” is now a category` : res.message)
    reload()
  }
  async function linkCategories() {
    if (!vehicle) return
    setBusy(true)
    const res = await runSave(async () => {
      for (const c of d!.unlinked) {
        await step(() => supabase.from('service_logs').update({ category_id: c.id }).eq('vehicle_id', vehicle.id).eq('service_type', c.name).is('category_id', null))
      }
    })
    setBusy(false)
    snack(res.ok ? 'Services linked to their categories' : res.message)
    reload()
  }
  function startMerge(dupes: ServiceLog[]) {
    const notes = [...new Set(dupes.map(l => l.notes?.trim()).filter(Boolean))].join('\n')
    const conflicts: { field: string; label: string; values: string[]; chosen: string }[] = []
    const odos = [...new Set(dupes.map(l => String(l.odometer)))]
    if (odos.length > 1) conflicts.push({ field: 'odometer', label: 'Odometer', values: odos, chosen: odos[0] })
    const shops = [...new Set(dupes.map(l => l.shop_name ?? '').filter(Boolean))]
    if (shops.length > 1) conflicts.push({ field: 'shop_name', label: 'Shop', values: shops, chosen: shops[0] })
    const costs = [...new Set(dupes.map(l => (l.cost != null ? String(l.cost) : '')).filter(Boolean))]
    if (costs.length > 1) conflicts.push({ field: 'cost', label: 'Cost', values: costs, chosen: costs[0] })
    if (conflicts.length) setMerge({ dupes, notes, conflicts })
    else void executeMerge(dupes, notes, {})
  }
  async function executeMerge(dupes: ServiceLog[], notes: string, overrides: Record<string, string>) {
    // Keep the record with the most information; fold the rest into it.
    const ranked = [...dupes].sort((a, b) =>
      ((b.cost != null ? 2 : 0) + (b.notes ? 1 : 0) + (b.receipt_url ? 3 : 0)) - ((a.cost != null ? 2 : 0) + (a.notes ? 1 : 0) + (a.receipt_url ? 3 : 0)))
    const [keep, ...drop] = ranked
    const update: Record<string, string | number | null> = { notes: notes || null }
    if (overrides.odometer) update.odometer = parseInt(overrides.odometer)
    if (overrides.shop_name !== undefined) update.shop_name = overrides.shop_name || null
    if (overrides.cost) update.cost = parseFloat(overrides.cost)
    setBusy(true)
    const res = await runSave(async () => {
      await step(() => supabase.from('service_logs').update(update).eq('id', keep.id))
      for (const l of drop) {
        if (l.receipt_url) await write(supabase.storage.from('receipts').remove([l.receipt_url]))
        await step(() => supabase.from('service_logs').delete().eq('id', l.id))
      }
    })
    setBusy(false); setMerge(null)
    snack(res.ok ? `Merged into one ${keep.service_type}` : `${res.message} The records were left as they were.`)
    reload()
  }
  async function deleteOne(log: ServiceLog) {
    setBusy(true)
    const res = await runSave(async () => {
      if (log.receipt_url) await write(supabase.storage.from('receipts').remove([log.receipt_url]))
      await step(() => supabase.from('service_logs').delete().eq('id', log.id))
    })
    setBusy(false)
    snack(res.ok ? 'Duplicate deleted' : `${res.message} The record is still there.`)
    setExtraOf(prev => prev?.filter(l => l.id !== log.id) ?? null)
    reload()
  }

  // ── Pieces ──────────────────────────────────────────────────────────────
  const statusRow = (s: CategoryStatus) => (
    <button key={s.cat.id} type="button" onClick={() => setCatOpen(s.cat.id)}
      className="relative w-full text-left px-4 py-3 before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.06]">
      <span className="flex items-center justify-between gap-3">
        <span className="type-body-lg text-on-surface truncate">{s.cat.name}</span>
        <span className={`type-label-lg tabular-nums shrink-0 ${s.isOverdue ? 'text-error' : s.isDueSoon ? 'text-[var(--md-warn)]' : 'text-on-surface-variant'}`}>
          {dueText(s).replace('Overdue by ', '+').replace('In ', '')}{s.isOverdue ? ' over' : ''}
        </span>
      </span>
      <Progress className="mt-2" value={s.used} tone={s.isOverdue ? 'error' : s.isDueSoon ? 'warn' : 'primary'} />
    </button>
  )

  const groupDetail = (g: Group) => {
    const byType = new Map<string, ServiceLog[]>()
    for (const l of g.logs) byType.set(l.service_type, [...(byType.get(l.service_type) ?? []), l])
    const dupes = [...byType.values()].filter(a => a.length > 1)
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="type-headline-sm text-on-surface">{day(g.date, 'EEEE, MMMM d, yyyy')}</p>
          <p className="type-body text-on-surface-variant">{mi(Math.max(...g.logs.map(l => l.odometer)))}{g.total != null && ` · ${usd(g.total)}`}</p>
        </div>
        {dupes.length > 0 && (
          <div className="rounded-xl bg-warn-container/60 p-3 flex flex-col gap-2">
            <p className="type-title-sm text-on-warn-container flex items-center gap-2"><Icon name="content_copy" size={18} />Logged twice on this day</p>
            {dupes.map(a => (
              <div key={a[0].service_type} className="flex flex-wrap items-center gap-2">
                <span className="type-body text-on-surface flex-1 min-w-0 truncate">{a[0].service_type} ({a.length}×)</span>
                <Button size="sm" variant="tonal" onClick={() => startMerge(a)}>Merge</Button>
                <Button size="sm" variant="text" onClick={() => setExtraOf(a)}>Delete extra</Button>
              </div>
            ))}
          </div>
        )}
        {g.logs.map(log => {
          const used = extras.usage.filter(u => u.log_id === log.id)
          const parts = [...used.reduce((m, u) => m.set(u.product_id, [...(m.get(u.product_id) ?? []), u]), new Map<string, typeof used>())]
          const bills = extras.billLinks.filter(b => b.log_id === log.id).map(b => extras.receipts.get(b.receipt_id)).filter(Boolean)
          const partReceipts = [...new Set(used.map(u => u.receipt_item_id && extras.items.get(u.receipt_item_id)?.receipt_id).filter(Boolean) as string[])]
            .map(id => extras.receipts.get(id)).filter(Boolean)
          const saving = diySaving(log)
          return (
            <Card key={log.id} variant="outlined" className="p-4 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <Avatar icon={log.performed_by === 'shop' ? 'storefront' : 'handyman'} tone={log.performed_by === 'shop' ? 'secondary' : 'primary'} />
                <div className="flex-1 min-w-0">
                  <p className="type-title text-on-surface">{log.service_type}</p>
                  <p className="type-body text-on-surface-variant">{log.performed_by === 'shop' ? (log.shop_name || 'Shop') : 'DIY'} · {mi(log.odometer)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="type-title tabular-nums text-on-surface">{log.cost != null ? usd(Number(log.cost)) : '—'}</p>
                  {saving != null && saving > 0 && <p className="type-body-sm text-[var(--md-success)]">saved {usd(saving)}</p>}
                </div>
              </div>
              {parts.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {parts.map(([pid, rows]) => {
                    const p = extras.products.get(pid)
                    const qty = rows.reduce((s, r) => s + Number(r.qty), 0)
                    const src = [...new Set(rows.map(r => {
                      const it = r.receipt_item_id ? extras.items.get(r.receipt_item_id) : null
                      const rc = it ? extras.receipts.get(it.receipt_id) : null
                      return rc ? `${rc.store || 'Receipt'}${rc.date ? ` · ${day(rc.date, 'MMM d')}` : ''}` : 'Stock without a receipt'
                    }))].join(', ')
                    return (
                      <div key={pid} className="flex items-center gap-2 type-body">
                        <Icon name="inventory_2" size={16} className="text-on-surface-variant" />
                        <span className="flex-1 min-w-0 truncate text-on-surface">{p ? [p.brand, p.name].filter(Boolean).join(' ') : 'Part'}<span className="text-on-surface-variant"> · {src}</span></span>
                        <span className="tabular-nums text-on-surface-variant">{fmtQty(qty, p?.unit)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
              {(bills.length > 0 || partReceipts.length > 0 || log.receipt_url) && (
                <div className="flex flex-wrap gap-2">
                  {bills.map(b => (
                    <Chip key={b!.id} icon="request_quote" onClick={() => b!.image_path && setPhoto(b!.image_path)}>{b!.store || 'Shop bill'}</Chip>
                  ))}
                  {log.receipt_url && <Chip icon="image" onClick={() => setPhoto(log.receipt_url)}>Receipt photo</Chip>}
                  {partReceipts.map(r => (
                    <Chip key={r!.id} icon="receipt_long" onClick={() => r!.image_path ? setPhoto(r!.image_path) : open({ kind: 'receipt', receiptId: r!.id })}>{r!.store || 'Receipt'} (parts)</Chip>
                  ))}
                </div>
              )}
              {log.notes && <p className="type-body text-on-surface-variant whitespace-pre-line">{log.notes}</p>}
              <div className="flex justify-end -mb-1 -mr-1">
                <Button variant="text" icon="edit" onClick={() => open({ kind: 'service', logId: log.id })}>Edit</Button>
              </div>
            </Card>
          )
        })}
      </div>
    )
  }

  const catStatus = catOpen ? d.statuses.find(s => s.cat.id === catOpen) ?? null : null
  const catObj = catOpen ? categories.find(c => c.id === catOpen) ?? null : null
  const catLogs = catObj ? services.filter(s => s.category_id === catObj.id) : []
  const catGaps = (() => {
    const asc = [...catLogs].filter(l => l.odometer > 0).sort((a, b) => a.date.localeCompare(b.date))
    const m: number[] = [], dd: number[] = []
    for (let i = 1; i < asc.length; i++) {
      if (asc[i].odometer > asc[i - 1].odometer) m.push(asc[i].odometer - asc[i - 1].odometer)
      const gap = differenceInDays(parseISO(asc[i].date), parseISO(asc[i - 1].date)); if (gap > 0) dd.push(gap)
    }
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null)
    return { miles: avg(m), days: avg(dd) }
  })()

  const actionsMenu = (
    <Menu
      trigger={({ toggle, open: o }) => <IconButton icon="more_vert" label="More actions" onClick={toggle} selected={o} />}
      items={[
        { label: 'Service categories', supporting: 'What you track and how often', icon: 'category', onClick: () => setModal('categories') },
        { label: 'Import from Carfax', supporting: 'Past services from a report', icon: 'upload_file', onClick: () => setModal('carfax') },
        { label: 'Export history (PDF)', supporting: 'With receipts, e.g. for selling the car', icon: 'picture_as_pdf', onClick: () => setModal('export') },
      ]}
    />
  )

  return (
    <Page>
      <PageHeader title="Services" subtitle={`${services.length} logged · ${Math.round(d.onTrack * 100)}% of the schedule on track`}
        actions={<>{actionsMenu}<Button icon="add" className="max-sm:hidden ml-1" onClick={() => open({ kind: 'service' })}>Log service</Button></>} />

      <Tabs className="-mx-4 sm:mx-0 mb-5" value={tab} onChange={setTab}
        tabs={[{ value: 'schedule', label: 'Schedule', icon: 'event_upcoming', badge: d.statuses.filter(s => s.isOverdue).length || undefined }, { value: 'history', label: 'History', icon: 'history' }]} />

      {error && !services.length && <EmptyState icon="cloud_off" title="Couldn’t load your services" body={error} action={<Button onClick={reload}>Try again</Button>} />}

      {tab === 'schedule' ? (
        loading ? <div className="grid lg:grid-cols-2 gap-4"><Skeleton className="h-96" /><Skeleton className="h-96" /></div> : d.statuses.length === 0 && d.unscheduled.length === 0 ? (
          <EmptyState icon="category" title="No service categories yet" body="Categories (oil change every 5,000 mi…) are what reminders come from."
            action={<Button onClick={() => setModal('categories')}>Set up categories</Button>} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-6 items-start">
            <Card variant="outlined" className="py-2 overflow-hidden">
              {(['service', 'check'] as const).map(kind => {
                const rows = d.statuses.filter(s => (s.cat.sub_type === 'check') === (kind === 'check'))
                if (!rows.length) return null
                return (
                  <div key={kind}>
                    <p className="px-4 pt-3 pb-1 type-title-sm text-on-surface-variant">{kind === 'check' ? 'Checks' : 'Services'}</p>
                    {rows.map(statusRow)}
                  </div>
                )
              })}
              {d.unscheduled.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 type-title-sm text-on-surface-variant">No schedule</p>
                  {d.unscheduled.map(c => (
                    <ListItem key={c.id} dense onClick={() => setCatOpen(c.id)} headline={c.name}
                      supporting={(() => { const l = services.find(s => s.category_id === c.id); return l ? `Last ${day(l.date, 'MMM d, yyyy')}` : 'Never logged' })()}
                      trailing={<Icon name="chevron_right" size={20} />} />
                  ))}
                </div>
              )}
            </Card>
            <div className="flex flex-col gap-6 min-w-0">
              <Card variant="filled" className="p-4 sm:p-6">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <p className="type-title-lg text-on-surface">Car health</p>
                    <p className="type-body text-on-surface-variant">Tap a part of the car to see what’s due there</p>
                  </div>
                  <Pill tone={d.statuses.some(s => s.isOverdue) ? 'due' : d.statuses.some(s => s.isDueSoon) ? 'soon' : 'ok'}>
                    {d.statuses.filter(s => s.isOverdue).length ? `${d.statuses.filter(s => s.isOverdue).length} overdue` : d.statuses.some(s => s.isDueSoon) ? 'Some due soon' : 'All good'}
                  </Pill>
                </div>
                <div className="mx-auto max-w-[420px]">
                  <CarHealthMap compact states={d.zones} tireCorners={d.corners}
                    onZone={z => { const it = d.zones.get(z)?.items[0]; if (it) it.id === 'tires:life' ? router.push('/products?tires=1') : setCatOpen(it.id) }} />
                </div>
              </Card>
              <CarHealthPanel states={d.zones} tireCorners={d.corners} heading={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                onItem={it => (it.id === 'tires:life' ? router.push('/products?tires=1') : setCatOpen(it.id))} />
            </div>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-6 items-start">
          <div className="flex flex-col gap-3 min-w-0">
            <div className="flex flex-wrap gap-2 items-center">
              {([['all', 'All time'], ['year', 'Year'], ['6mo', '6 months'], ['3mo', '3 months']] as const).map(([k, l]) => (
                <Chip key={k} selected={period === k} onClick={() => setPeriod(k)}>{l}</Chip>
              ))}
            </div>
            <SelectField label="Type of service" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">Every type</option>
              {types.map(t => <option key={t}>{t}</option>)}
            </SelectField>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-surface-container-low px-3 py-2.5"><p className="type-label text-on-surface-variant">Services</p><p className="type-title-lg tabular-nums">{filtered.length}</p></div>
              <div className="rounded-xl bg-surface-container-low px-3 py-2.5"><p className="type-label text-on-surface-variant">Spent</p><p className="type-title-lg tabular-nums">${Math.round(spent).toLocaleString()}</p></div>
              <div className="rounded-xl bg-surface-container-low px-3 py-2.5"><p className="type-label text-on-surface-variant">DIY saved</p><p className="type-title-lg tabular-nums text-[var(--md-success)]">${Math.round(saved).toLocaleString()}</p></div>
            </div>
            {d.unlinked.length > 0 && (
              <div className="rounded-xl bg-primary-container/50 p-3 flex items-center gap-3">
                <Icon name="link" size={20} className="text-on-primary-container" />
                <p className="type-body text-on-surface flex-1">Some services match a category but aren’t linked, so reminders miss them.</p>
                <Button size="sm" variant="tonal" loading={busy} onClick={linkCategories}>Link</Button>
              </div>
            )}
            {d.uncategorised.length > 0 && (
              <div className="rounded-xl bg-surface-container-low p-3 flex flex-col gap-2">
                <p className="type-body text-on-surface">Not in a category yet, so no reminders:</p>
                <div className="flex flex-wrap gap-2">{d.uncategorised.slice(0, 8).map(t => <Chip key={t} icon="add" onClick={() => addAsCategory(t)}>{t}</Chip>)}</div>
              </div>
            )}
            <Card variant="outlined" className="py-1 overflow-hidden">
              {groups.length === 0 ? (
                <EmptyState icon="build" title={services.length ? 'Nothing in this period' : 'No services yet'} body={services.length ? 'Try a longer period or another type.' : 'Log your first service and it shows up here.'}
                  action={!services.length && <Button icon="add" onClick={() => open({ kind: 'service' })}>Log service</Button>} />
              ) : groups.map((g, i) => {
                const month = g.date.slice(0, 7)
                const newMonth = i === 0 || groups[i - 1].date.slice(0, 7) !== month
                const shop = g.logs.find(l => l.performed_by === 'shop')
                return (
                  <div key={g.key}>
                    {newMonth && <p className="px-4 pt-4 pb-1 type-title-sm text-on-surface-variant">{day(g.date, 'MMMM yyyy')}</p>}
                    <ListItem onClick={() => setGroupKey(g.key)} selected={groupKey === g.key}
                      leading={<Avatar icon={shop ? 'storefront' : 'handyman'} tone={shop ? 'secondary' : 'primary'} />}
                      headline={g.logs.map(l => l.service_type).join(', ')}
                      supporting={`${day(g.date, 'EEE, MMM d')} · ${mi(Math.max(...g.logs.map(l => l.odometer)))}${shop?.shop_name ? ` · ${shop.shop_name}` : ''}`}
                      trailing={g.total != null ? <span className="text-on-surface">{usd(g.total)}</span> : undefined} />
                  </div>
                )
              })}
            </Card>
          </div>
          <div className="max-lg:hidden sticky top-6">
            {selected ? groupDetail(selected) : (
              <Card variant="filled" className="p-8"><EmptyState icon="build" title="Pick a service" body="Its parts, receipts and notes show here." /></Card>
            )}
          </div>
        </div>
      )}

      {/* Phones: the selected day opens full screen. */}
      <Dialog open={Boolean(selected) && !desktop} onClose={() => setGroupKey(null)} title={selected ? day(selected.date, 'MMM d, yyyy') : ''} size="lg">
        {selected && groupDetail(selected)}
      </Dialog>

      {/* Category detail */}
      <Dialog open={Boolean(catObj)} onClose={() => setCatOpen(null)} title={catObj?.name ?? ''} size="md"
        subtitle={catObj?.interval_miles || catObj?.interval_days ? `Every ${[catObj?.interval_miles ? mi(catObj.interval_miles) : null, catObj?.interval_days ? `${Math.round(catObj.interval_days / 30)} months` : null].filter(Boolean).join(' or ')}` : 'No schedule'}
        primary={catObj ? { label: `Log ${catObj.name}`, onClick: () => { const id = catObj.id; setCatOpen(null); open({ kind: 'service', categoryId: id }) } } : undefined}>
        {catObj && (
          <div className="flex flex-col gap-5">
            {catStatus && (
              <div className="rounded-xl bg-surface-container-highest/60 p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="type-title text-on-surface">{catStatus.isOverdue ? 'Overdue' : catStatus.isDueSoon ? 'Due soon' : 'On track'}</span>
                  <Pill tone={catStatus.isOverdue ? 'due' : catStatus.isDueSoon ? 'soon' : 'ok'}>{dueText(catStatus)}</Pill>
                </div>
                <Progress value={catStatus.used} tone={catStatus.isOverdue ? 'error' : catStatus.isDueSoon ? 'warn' : 'primary'} />
                <p className="type-body-sm text-on-surface-variant mt-2">
                  {catStatus.lastDate ? `Last done ${day(catStatus.lastDate)} at ${mi(catStatus.lastOdo!)}` : 'Never logged'}
                  {catStatus.nextOdo ? ` · next at ${mi(catStatus.nextOdo)}` : ''}{catStatus.nextDate ? ` or by ${day(catStatus.nextDate, 'MMM yyyy')}` : ''}
                </p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-surface-container-low px-3 py-2.5"><p className="type-label text-on-surface-variant">Done</p><p className="type-title-lg tabular-nums">{catLogs.length}×</p></div>
              <div className="rounded-xl bg-surface-container-low px-3 py-2.5"><p className="type-label text-on-surface-variant">Usually every</p><p className="type-title-lg tabular-nums">{catGaps.miles ? mi(catGaps.miles) : '—'}</p></div>
              <div className="rounded-xl bg-surface-container-low px-3 py-2.5"><p className="type-label text-on-surface-variant">Spent</p><p className="type-title-lg tabular-nums">${Math.round(catLogs.reduce((s, l) => s + Number(l.cost ?? 0), 0)).toLocaleString()}</p></div>
            </div>
            {catalog.filter(p => p.category_id === catObj.id).length > 0 && (
              <div>
                <p className="type-title-sm text-on-surface-variant mb-1">Usually uses</p>
                {catalog.filter(p => p.category_id === catObj.id).map(p => (
                  <p key={p.id} className="type-body text-on-surface">{p.name}{p.last_price != null && <span className="text-on-surface-variant"> · last ${Number(p.last_price).toFixed(2)}</span>}</p>
                ))}
              </div>
            )}
            <div className="-mx-4 sm:-mx-6">
              <p className="px-4 sm:px-6 type-title-sm text-on-surface-variant mb-1">History</p>
              {catLogs.length === 0 ? <p className="px-6 type-body text-on-surface-variant">Not logged yet.</p> : catLogs.map(l => (
                <ListItem key={l.id} dense onClick={() => { setCatOpen(null); setTab('history'); setGroupKey(l.date) }}
                  leading={<Avatar icon={l.performed_by === 'shop' ? 'storefront' : 'handyman'} tone={l.performed_by === 'shop' ? 'secondary' : 'primary'} size={36} />}
                  headline={day(l.date)} supporting={`${mi(l.odometer)} · ${l.performed_by === 'shop' ? (l.shop_name || 'Shop') : 'DIY'}`}
                  trailing={l.cost != null ? <span className="text-on-surface">{usd(Number(l.cost))}</span> : undefined} />
              ))}
            </div>
          </div>
        )}
      </Dialog>

      {/* Receipt photo */}
      <Dialog open={Boolean(photo)} onClose={() => setPhoto(null)} title="Receipt" size="lg">
        {photo && <div className="rounded-xl overflow-hidden bg-surface-container-highest"><ReceiptViewer path={photo} fit className="w-full min-h-[60vh]" /></div>}
      </Dialog>

      {/* Duplicates */}
      <Dialog open={Boolean(extraOf?.length)} onClose={() => setExtraOf(null)} title="Delete which one?" variant="basic" size="sm">
        <div className="flex flex-col gap-2 -mx-2">
          {extraOf?.map(l => (
            <div key={l.id} className="flex items-center gap-3 rounded-xl border border-outline-variant p-3">
              <div className="flex-1 min-w-0">
                <p className="type-body-lg text-on-surface">{l.service_type}</p>
                <p className="type-body-sm text-on-surface-variant">{mi(l.odometer)} · {l.cost != null ? usd(Number(l.cost)) : 'no cost'}{l.receipt_url ? ' · has receipt' : ''}{l.notes ? ' · has notes' : ''}</p>
              </div>
              <Button size="sm" variant="danger" disabled={busy || (extraOf?.length ?? 0) < 2} onClick={() => deleteOne(l)}>Delete</Button>
            </div>
          ))}
        </div>
      </Dialog>
      <Dialog open={Boolean(merge)} onClose={() => setMerge(null)} title="Merge duplicates" variant="basic" size="sm"
        primary={merge ? { label: 'Merge', loading: busy, onClick: () => executeMerge(merge.dupes, merge.notes, Object.fromEntries(merge.conflicts.map(c => [c.field, c.chosen]))) } : undefined}>
        {merge && (
          <div className="flex flex-col gap-4">
            <p>They disagree on a few things. Pick what the merged record keeps:</p>
            {merge.conflicts.map((c, i) => (
              <SelectField key={c.field} label={c.label} value={c.chosen}
                onChange={e => setMerge(m => m && { ...m, conflicts: m.conflicts.map((x, j) => j === i ? { ...x, chosen: e.target.value } : x) })}>
                {c.values.map(v => <option key={v} value={v}>{c.field === 'cost' ? `$${v}` : c.field === 'odometer' ? mi(+v) : v}</option>)}
              </SelectField>
            ))}
          </div>
        )}
      </Dialog>

      {modal === 'export' && <ExportPdfModal vehicle={vehicle} logs={services} categories={categories} onClose={() => setModal(null)} />}
      {modal === 'carfax' && <CarfaxImportModal vehicle={vehicle} categories={categories} onClose={() => setModal(null)} onImported={reload} />}
      {modal === 'categories' && <CategoryManagerModal vehicle={vehicle} onClose={() => setModal(null)} onUpdated={reload} />}
    </Page>
  )
}
