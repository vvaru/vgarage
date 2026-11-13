'use client'

import { useState } from 'react'
import { format, getMonth, parseISO, subDays, subMonths, subYears } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { runSave, step } from '@/lib/recover'
import { recomputeFuelMpg } from '@/lib/fuelMpg'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { useForms } from '@/components/shell/forms'
import PageHeader, { Page } from '@/components/shell/PageHeader'
import { useCarData } from '@/lib/useCarData'
import { useIsDesktop } from '@/lib/useMedia'
import {
  aggressivePremium, bucketByMonth, buildPoints, detectMissedFills, forecastMonth, MODE_LABELS, modeBands, modeCosts,
  rollingCostPerMile, savingsTrend, seasonBests, seasonInstanceKey, type FuelPoint,
} from '@/lib/fuelAnalytics'
import { FuelLine, FuelModes, MODE_COLORS, MonthBars, type SeriesPoint } from '@/components/charts/FuelCharts'
import { Legend } from '@/components/charts/TrendCharts'
import {
  Avatar, Button, Card, Chip, Confirm, Dialog, EmptyState, Icon, IconButton, ListItem, Metric, Pill, Segmented, Skeleton, useSnackbar,
} from '@/components/ui/md'
import type { FuelLog } from '@/lib/types'

type Period = 'week' | 'month' | '3mo' | 'year' | 'all'
type Metric2 = 'mpg' | 'cpm'

const PERIODS: { key: Period; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: '3mo', label: '3 months' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All' },
]

const SEASONS = [
  { label: 'Winter', months: [11, 0, 1] },
  { label: 'Spring', months: [2, 3, 4] },
  { label: 'Summer', months: [5, 6, 7] },
  { label: 'Fall', months: [8, 9, 10] },
]

// "All" groups by month only once plotting each fill-up would be unreadable.
const BUCKET_ABOVE = 40
const PHONE_ROWS = 6

const usd = (n: number, digits = 2) => `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
const shortDate = (d: string) => format(parseISO(d), 'MMM d')

function cutoffOf(period: Period): Date | null {
  const now = new Date()
  if (period === 'week') return subDays(now, 7)
  if (period === 'month') return subMonths(now, 1)
  if (period === '3mo') return subMonths(now, 3)
  if (period === 'year') return subYears(now, 1)
  return null
}

// Manual "count it" / "don't count it" choices on a fill-up's MPG, kept per device.
const KEEP_KEY = 'vgarage_mpg_keep'
const EXCLUDE_KEY = 'vgarage_mpg_exclude'
function loadIds(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]) } catch { return new Set() }
}
function saveIds(key: string, ids: Set<string>) {
  try { localStorage.setItem(key, JSON.stringify([...ids])) } catch { /* only forgets the choice on this device */ }
}

export default function FuelPage() {
  const { vehicle, refresh } = useVehicle()
  const { open, changed } = useForms()
  const snack = useSnackbar()
  const desktop = useIsDesktop()
  const { fuel: logs, loading, error, reload } = useCarData(vehicle?.id)
  // Three months is enough fill-ups for a trend to have a shape, without
  // reaching so far back that recent driving gets averaged away.
  const [period, setPeriod] = useState<Period>('3mo')
  const [metric, setMetric] = useState<Metric2>('mpg')
  const [splitModes, setSplitModes] = useState(false)
  const [showPrice, setShowPrice] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [toDelete, setToDelete] = useState<FuelLog | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [keep, setKeep] = useState(() => loadIds(KEEP_KEY))
  const [exclude, setExclude] = useState(() => loadIds(EXCLUDE_KEY))

  function markReal(id: string) {
    const k = new Set(keep).add(id), x = new Set(exclude); x.delete(id)
    setKeep(k); setExclude(x); saveIds(KEEP_KEY, k); saveIds(EXCLUDE_KEY, x)
  }
  function markMissed(id: string) {
    const x = new Set(exclude).add(id), k = new Set(keep); k.delete(id)
    setKeep(k); setExclude(x); saveIds(KEEP_KEY, k); saveIds(EXCLUDE_KEY, x)
  }

  async function remove() {
    if (!toDelete || !vehicle) return
    setDeleting(true); setActionError(null)
    const res = await runSave(() => step(() => supabase.from('fuel_logs').delete().eq('id', toDelete.id)).then(() => {}))
    setDeleting(false)
    setToDelete(null)
    if (!res.ok) { setActionError(`${res.message} The fill-up is still there.`); return }
    setSelected(null)
    // Removing a fill-up changes the "previous" for the one after it.
    await recomputeFuelMpg(vehicle.id)
    changed()
    await refresh()
    snack('Fill-up deleted')
  }

  if (!vehicle) return null

  const header = (
    <PageHeader title="Fuel" subtitle={logs.length ? `${logs.length} fill-up${logs.length === 1 ? '' : 's'} logged` : 'Fill-ups, MPG and what they cost'}
      actions={<Button icon="add" className="max-sm:hidden" onClick={() => open({ kind: 'fuel' })}>Log fuel</Button>} />
  )

  if (loading) {
    return <Page>{header}<div className="grid gap-4"><div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}</div><Skeleton className="h-96" /></div></Page>
  }
  if (!logs.length) {
    return (
      <Page>
        {header}
        {error
          ? <EmptyState icon="cloud_off" title="Couldn’t load your fill-ups" body={error} action={<Button onClick={reload}>Try again</Button>} />
          : <EmptyState icon="local_gas_station" title="No fill-ups yet" body="Log one every time you fill up to track MPG and fuel spend."
              action={<Button icon="add" onClick={() => open({ kind: 'fuel' })}>Log your first fill-up</Button>} />}
      </Page>
    )
  }

  const cutoff = cutoffOf(period)
  const inPeriod = cutoff ? logs.filter(l => parseISO(l.date) >= cutoff) : logs

  // A reading is left out of MPG if you said so, or it looks like a missed fill-up
  // and you haven't said it's real.
  const missedFlags = detectMissedFills(logs)
  const outliers = new Set(logs.filter(l => l.mpg != null && (exclude.has(l.id) || (missedFlags.has(l.id) && !keep.has(l.id)))).map(l => l.id))

  const counted = inPeriod.filter(l => l.mpg != null && !outliers.has(l.id))
  const avgMpg = counted.length ? counted.reduce((s, l) => s + Number(l.mpg), 0) / counted.length : null
  const spent = inPeriod.reduce((s, l) => s + Number(l.total_cost ?? 0), 0)
  const gallons = inPeriod.reduce((s, l) => s + Number(l.gallons ?? 0), 0)

  const seasons = SEASONS.map(season => {
    const rows = logs.filter(l => season.months.includes(getMonth(parseISO(l.date))) && l.mpg != null && !outliers.has(l.id))
    return { label: season.label, avg: rows.length ? rows.reduce((s, l) => s + Number(l.mpg), 0) / rows.length : null, count: rows.length }
  })

  // Points come from ALL logs so miles-since-last-fill can look back past the
  // period boundary, then get filtered.
  const allPoints = buildPoints(logs, outliers)
  const points = cutoff ? allPoints.filter(p => parseISO(p.date) >= cutoff) : allPoints
  const cpm = rollingCostPerMile(points)
  const costs = modeCosts(points)
  const premium = aggressivePremium(costs)
  const forecast = forecastMonth(allPoints)
  const savingsByMonth = bucketByMonth(points, p => p.savings, 'sum')
  const direction = savingsTrend(savingsByMonth)
  const leftOnTable = points.reduce((s, p) => s + (p.savings ?? 0), 0)
  const bests = seasonBests(logs, outliers)
  const savedFor = (l: FuelLog): number | null => {
    if (l.mpg == null || outliers.has(l.id) || l.total_cost == null) return null
    const best = bests.get(seasonInstanceKey(l.date))
    if (!best) return null
    return Math.max(0, Number(l.total_cost) * (1 - Number(l.mpg) / best))
  }

  const byMonth = period === 'all' && points.length > BUCKET_ABOVE
  const bucketed = (val: (p: FuelPoint) => number | null): SeriesPoint[] => byMonth
    ? bucketByMonth(points, val, 'avg').map(b => ({ date: b.label, value: b.value }))
    : points.flatMap(p => { const v = val(p); return v == null ? [] : [{ date: shortDate(p.date), value: v }] })
  const mpgSeries = bucketed(p => (p.log.mpg != null && !outliers.has(p.log.id) ? Number(p.log.mpg) : null))
  const cpmSeries = bucketed(p => p.costPerMile)
  const priceSeries = bucketed(p => p.pricePerGallon)
  // Mode is per fill-up, so it never buckets: a month's average would erase it.
  const modeSeries: SeriesPoint[] = points.filter(p => p.log.mpg != null && p.mode != null)
    .map(p => ({ date: shortDate(p.date), value: Number(p.log.mpg), mode: p.mode }))
  const canSplit = modeSeries.length >= 2
  const split = metric === 'mpg' && splitModes && canSplit
  const trend = metric === 'mpg' ? mpgSeries : cpmSeries
  const bands = modeBands(logs, outliers)
  const modeAvg = (m: string) => costs.find(c => c.mode === m)?.avgMpg ?? null
  const efficientAvg = modeAvg('efficient'), aggressiveAvg = modeAvg('aggressive')
  const modeGap = efficientAvg != null && aggressiveAvg != null ? efficientAvg - aggressiveAvg : null

  const current = desktop ? (logs.find(l => l.id === selected) ?? inPeriod[0] ?? null) : (logs.find(l => l.id === selected) ?? null)
  const shownRows = desktop || showAll ? inPeriod : inPeriod.slice(0, PHONE_ROWS)

  const detail = current && (
    <FillUpDetail log={current} isOutlier={outliers.has(current.id)} looksMissed={missedFlags.has(current.id) && !exclude.has(current.id)}
      saved={savedFor(current)} onEdit={() => { setSelected(null); open({ kind: 'fuel', logId: current.id }) }}
      onDelete={() => setToDelete(current)} onReal={() => markReal(current.id)} onMissed={() => markMissed(current.id)} />
  )

  const charts = (
    <div className="flex flex-col gap-4 min-w-0">
      {trend.length >= 2 && (
        <Card variant="outlined" className="p-4 sm:p-5 flex flex-col gap-4 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="type-title text-on-surface flex-1 min-w-40">
              {metric === 'mpg' ? 'MPG trend' : 'Cost per mile'}
              {byMonth && !split && <span className="type-body text-on-surface-variant"> · monthly</span>}
            </h2>
            {metric === 'mpg' && canSplit && <Chip selected={splitModes} onClick={() => setSplitModes(v => !v)}>Split by mode</Chip>}
            <Segmented size="sm" value={metric} onChange={setMetric} label="What to chart"
              options={[{ value: 'mpg', label: 'MPG' }, { value: 'cpm', label: 'Cost / mile' }]} />
          </div>
          {split ? (
            <>
              <Legend items={[
                ...(efficientAvg != null ? [{ label: `Efficient, avg ${efficientAvg.toFixed(1)}`, color: MODE_COLORS.efficient }] : []),
                ...(aggressiveAvg != null ? [{ label: `Aggressive, avg ${aggressiveAvg.toFixed(1)}`, color: MODE_COLORS.aggressive }] : []),
                { label: 'Mixed', color: MODE_COLORS.mixed },
              ]} />
              <FuelModes data={modeSeries} efficientAvg={efficientAvg} aggressiveAvg={aggressiveAvg} />
              {bands && (
                <p className="type-body-sm text-on-surface-variant">
                  Your typical is {bands.center.toFixed(1)} mpg: efficient at {bands.efficientAt.toFixed(1)} or better, aggressive at {bands.aggressiveAt.toFixed(1)} or below.
                  {modeGap != null && <> Driving aggressively costs you about <span className="text-on-surface font-medium">{modeGap.toFixed(1)} mpg</span>.</>}
                </p>
              )}
            </>
          ) : metric === 'mpg'
            ? <FuelLine data={mpgSeries} name="MPG" fmt={n => `${n.toFixed(1)} mpg`} />
            : <FuelLine data={cpmSeries} name="Cost / mile" fmt={n => `$${n.toFixed(3)}`} tickFmt={n => `$${n.toFixed(2)}`} color="var(--data-service)" />}
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {leftOnTable >= 0.005 && (
          <Card variant="outlined" className="p-4 sm:p-5 flex flex-col gap-2 min-w-0">
            <p className="type-label-lg text-on-surface-variant flex items-center gap-1.5"><Icon name="eco" size={18} className="text-[var(--md-success)]" />Could have saved</p>
            <p className="type-headline-sm text-on-surface tabular-nums">{usd(leftOnTable)}</p>
            <p className="type-body-sm text-on-surface-variant">
              By matching your best MPG each season{period === 'all' ? ', all time' : ''}.
              {direction && <> The gap is {direction === 'improving' ? 'shrinking' : 'growing'} compared with last month.</>}
            </p>
            {savingsByMonth.length >= 2 && <MonthBars data={savingsByMonth} name="Could have saved" fmt={n => usd(n)} />}
          </Card>
        )}
        <Card variant="outlined" className="p-4 sm:p-5 flex flex-col gap-3 min-w-0">
          <p className="type-label-lg text-on-surface-variant">Seasonal MPG</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {seasons.map(s => (
              <div key={s.label}>
                <p className="type-title-lg text-on-surface tabular-nums">{s.avg != null ? s.avg.toFixed(1) : '—'}</p>
                <p className="type-body-sm text-on-surface-variant">{s.label}{s.count > 0 ? ` · ${s.count} fill${s.count === 1 ? '' : 's'}` : ''}</p>
              </div>
            ))}
          </div>
        </Card>
        {forecast && (
          <Metric icon="event_upcoming" label="Projected this month" value={`~${usd(forecast.projected, 0)}`}
            sub={`${usd(forecast.spentSoFar, 0)} so far · ${forecast.dailyMiles.toFixed(0)} mi/day, ${forecast.daysLeft} days left`} />
        )}
        {premium != null && (
          <Metric icon="speed" label="Aggressive driving costs" value={`+${usd(premium)}`} unit="per 100 mi"
            sub={costs.filter(c => c.costPer100 != null).map(c => `${MODE_LABELS[c.mode]} ${usd(c.costPer100!)}`).join(' · ')} />
        )}
      </div>

      {priceSeries.length >= 2 && (
        <Card variant="outlined" className="overflow-hidden min-w-0">
          <button type="button" onClick={() => setShowPrice(v => !v)} aria-expanded={showPrice}
            className="relative w-full flex items-center gap-3 p-4 sm:px-5 text-left before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.08]">
            <span className="flex-1 type-title text-on-surface">Price per gallon{byMonth && <span className="type-body text-on-surface-variant"> · monthly</span>}</span>
            <span className="type-body text-on-surface-variant tabular-nums">Latest {usd(priceSeries[priceSeries.length - 1].value)}</span>
            <Icon name={showPrice ? 'expand_less' : 'expand_more'} size={24} className="text-on-surface-variant" />
          </button>
          {showPrice && (
            <div className="px-4 sm:px-5 pb-4">
              <FuelLine data={priceSeries} name="Price" fmt={n => `$${n.toFixed(3)}`} tickFmt={n => `$${n.toFixed(2)}`} color="var(--md-on-surface-variant)" height={180} />
            </div>
          )}
        </Card>
      )}
    </div>
  )

  return (
    <Page>
      {header}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 mb-4">
        {PERIODS.map(p => <Chip key={p.key} selected={period === p.key} onClick={() => { setPeriod(p.key); setShowAll(false) }}>{p.label}</Chip>)}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Metric icon="local_gas_station" label="Average" value={avgMpg != null ? avgMpg.toFixed(1) : '—'} unit="mpg" />
        <Metric icon="route" label="Cost per mile" value={cpm != null ? `$${cpm.toFixed(3)}` : '—'} />
        <Metric icon="payments" label="Spent" value={usd(spent, 0)} />
        <Metric icon="water_drop" label="Gallons" value={gallons.toFixed(0)} />
        <Metric icon="history" label="Fill-ups" value={inPeriod.length} className="max-lg:col-span-2" />
      </div>

      {actionError && <p role="alert" className="type-body text-error mb-4">{actionError}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-6 items-start">
        <div className="flex flex-col gap-2 min-w-0 lg:sticky lg:top-6">
          <Card variant="outlined" className="py-1 overflow-hidden lg:max-h-[calc(100vh-48px)] lg:overflow-y-auto">
            {inPeriod.length === 0 && <EmptyState icon="local_gas_station" title="No fill-ups in this period" />}
            {shownRows.map(l => (
              <ListItem key={l.id} onClick={() => setSelected(l.id)} selected={desktop && current?.id === l.id}
                leading={<Avatar icon="local_gas_station" tone="fuel" />}
                headline={[l.total_cost != null ? usd(Number(l.total_cost)) : null, l.gallons != null ? `${Number(l.gallons).toFixed(2)} gal` : null].filter(Boolean).join(' · ') || 'Fill-up'}
                supporting={`${format(parseISO(l.date), 'MMM d, yyyy')} · ${l.odometer.toLocaleString()} mi`}
                trailing={l.mpg == null ? <span className="type-body">—</span>
                  : outliers.has(l.id) ? <Pill tone="soon" icon="warning">{Number(l.mpg).toFixed(1)}</Pill>
                  : <span className="text-on-surface">{Number(l.mpg).toFixed(1)} mpg</span>} />
            ))}
          </Card>
          {!desktop && inPeriod.length > PHONE_ROWS && (
            <Button variant="text" className="self-center" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${inPeriod.length}`}</Button>
          )}
        </div>
        <div className="flex flex-col gap-4 min-w-0">
          {desktop && detail && <Card variant="filled" className="p-5">{detail}</Card>}
          {charts}
        </div>
      </div>

      {!desktop && current && (
        <Dialog open onClose={() => setSelected(null)} title={format(parseISO(current.date), 'MMM d, yyyy')} size="md">{detail}</Dialog>
      )}

      <Confirm open={Boolean(toDelete)} title="Delete this fill-up?" confirmLabel="Delete" danger busy={deleting}
        onCancel={() => setToDelete(null)} onConfirm={remove}
        body="The MPG of the next fill-up is worked out again without it. This can’t be undone." />
    </Page>
  )
}

function FillUpDetail({ log, isOutlier, looksMissed, saved, onEdit, onDelete, onReal, onMissed }: {
  log: FuelLog; isOutlier: boolean; looksMissed: boolean; saved: number | null
  onEdit: () => void; onDelete: () => void; onReal: () => void; onMissed: () => void
}) {
  const facts: [string, string][] = [
    ['Cost', log.total_cost != null ? usd(Number(log.total_cost)) : '—'],
    ['Odometer', `${log.odometer.toLocaleString()} mi`],
    ['Gallons', log.gallons != null ? Number(log.gallons).toFixed(3) : '—'],
    ['Price', log.price_per_gallon != null ? `$${Number(log.price_per_gallon).toFixed(3)}/gal` : '—'],
    ['MPG', log.mpg != null ? Number(log.mpg).toFixed(1) : '—'],
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="flex-1 type-title text-on-surface max-lg:hidden">{format(parseISO(log.date), 'MMMM d, yyyy')}</p>
        <div className="flex gap-1 max-lg:hidden">
          <IconButton icon="edit" label="Edit" onClick={onEdit} />
          <IconButton icon="delete" label="Delete" onClick={onDelete} />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-4 gap-y-3">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <p className="type-label text-on-surface-variant">{k}</p>
            <p className="type-body-lg text-on-surface tabular-nums truncate">{v}</p>
          </div>
        ))}
      </div>
      {log.mpg != null && (isOutlier ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex-1 min-w-48 type-body text-on-surface-variant flex gap-2"><Icon name="warning" size={18} className="text-[var(--md-warn)] shrink-0" />
            Not counted in your MPG{looksMissed ? ': it looks like a fill-up before this one wasn’t logged.' : '.'}</p>
          <Button size="sm" variant="tonal" onClick={onReal}>It’s real, count it</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex-1 min-w-48 type-body text-on-surface-variant">
            {saved == null ? 'Counted in your MPG.' : saved >= 0.005 ? `Could have saved ${usd(saved)} driving at this season’s best.` : 'Your best MPG this season.'}
          </p>
          <Button size="sm" variant="text" onClick={onMissed}>I missed a fill-up before this</Button>
        </div>
      ))}
      <div className="flex gap-2 lg:hidden">
        <Button variant="tonal" icon="edit" onClick={onEdit}>Edit</Button>
        <Button variant="danger" icon="delete" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  )
}
