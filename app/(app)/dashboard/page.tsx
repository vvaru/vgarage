'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { runSave, step } from '@/lib/recover'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { useForms } from '@/components/shell/forms'
import PageHeader, { Page } from '@/components/shell/PageHeader'
import {
  Avatar, Button, Card, CompareBars, Delta, Dialog, EmptyState, IconButton, ListItem, Pill, Progress,
  Segmented, Skeleton, Sparkline, TextField, useSnackbar, Icon, type IconName,
} from '@/components/ui/md'
import { WeeklyMilesChart, MonthlySpendChart, Legend } from '@/components/charts/TrendCharts'
import { useCarData } from '@/lib/useCarData'
import { milesPerMonth, estimatedOdometer, scheduleStatuses, dueText, upcomingCosts } from '@/lib/schedule'
import { mileageSeries, drivingSummary, spendSummary, insights, pctChange } from '@/lib/trends'
import { buildPoints, totalSavings, forecastMonth, rollingCostPerMile } from '@/lib/fuelAnalytics'

const usd = (n: number, cents = false) => `$${n.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`
const mi = (n: number) => `${Math.round(n).toLocaleString()} mi`
const short = (d: string) => format(parseISO(d), 'MMM d')

const PERIODS = [
  { value: '1', label: '1 mo' }, { value: '3', label: '3 mo' }, { value: '6', label: '6 mo' }, { value: '12', label: '1 yr' },
] as const

export default function HomePage() {
  const { vehicle, refresh } = useVehicle()
  const { open } = useForms()
  const snack = useSnackbar()
  const { categories, services, fuel, catalog, loading } = useCarData(vehicle?.id)
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['value']>('3')
  const [odoOpen, setOdoOpen] = useState(false)
  const [newOdo, setNewOdo] = useState('')
  const [odoSaving, setOdoSaving] = useState(false)

  const derived = useMemo(() => {
    if (!vehicle) return null
    const perMonth = milesPerMonth(services, fuel)
    const est = estimatedOdometer(vehicle.odometer, services, fuel, perMonth)
    const statuses = scheduleStatuses(categories.filter(c => c.category_type === 'maintenance'), services, est.odo)
    const series = mileageSeries(fuel, services)
    const driving = series ? drivingSummary(series) : null
    const spend = spendSummary(fuel, services)
    const points = buildPoints(fuel)
    const mpgs = [...fuel].reverse().map(f => f.mpg).filter((m): m is number => m != null && m > 0)
    const recentMpg = mpgs.slice(-5), beforeMpg = mpgs.slice(-10, -5)
    const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)
    let miles12: number | null = null
    if (series) { miles12 = 0; for (const [d, v] of series.daily) if (d > series.lastDay - 365) miles12 += v }
    const mpgRecent = avg(recentMpg), mpgBefore = beforeMpg.length >= 3 ? avg(beforeMpg) : null
    return {
      perMonth, est, statuses, driving, spend, mpgRecent, mpgBefore, mpgSpark: mpgs.slice(-12),
      leftOnTable: totalSavings(points), forecast: forecastMonth(points), fuelCpm: rollingCostPerMile(points),
      costPerMile: miles12 && miles12 > 500 ? spend.last12.total / miles12 : null,
      firstFuel: fuel.length ? fuel[fuel.length - 1].date : null,
      insightList: insights(driving, spend, mpgRecent, mpgBefore),
    }
  }, [vehicle, categories, services, fuel])

  if (!vehicle || !derived) return null
  const { est, statuses, driving, spend } = derived
  const attention = statuses.filter(s => s.isOverdue || s.isDueSoon)
  const next = statuses[0] ?? null
  const upcoming = upcomingCosts(statuses, services, catalog, Number(period), est.odo, derived.perMonth)
  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const recent = [
    ...services.slice(0, 8).map(s => ({
      id: s.id, date: s.date, icon: (s.performed_by === 'shop' ? 'storefront' : 'build') as IconName,
      tone: (s.performed_by === 'shop' ? 'secondary' : 'primary') as 'secondary' | 'primary', title: s.service_type,
      sub: `${mi(s.odometer)} · ${s.performed_by === 'shop' ? (s.shop_name || 'Shop') : 'DIY'}`, amount: s.cost, href: `/service?log=${s.id}`,
    })),
    ...fuel.slice(0, 8).map(f => ({
      id: f.id, date: f.date, icon: 'local_gas_station' as IconName, tone: 'fuel' as const, title: 'Fuel',
      sub: `${mi(f.odometer)}${f.gallons ? ` · ${Number(f.gallons).toFixed(1)} gal` : ''}${f.mpg ? ` · ${Number(f.mpg).toFixed(1)} mpg` : ''}`,
      amount: f.total_cost, href: '/fuel',
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8)

  async function saveOdometer() {
    if (!vehicle) return
    const val = parseInt(newOdo)
    if (isNaN(val) || val < vehicle.odometer) return
    setOdoSaving(true)
    const res = await runSave(() => step(() => supabase.from('vehicles').update({ odometer: val }).eq('id', vehicle.id)).then(() => {}))
    setOdoSaving(false)
    if (!res.ok) { snack(`${res.message} The odometer was not changed.`); return }
    await refresh()
    setOdoOpen(false)
    setNewOdo('')
    snack('Odometer updated')
  }

  const odoLow = newOdo !== '' && parseInt(newOdo) < vehicle.odometer

  return (
    <Page>
      <PageHeader
        eyebrow={greeting}
        title={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
        showVehicle={false}
        actions={<IconButton icon="speed" label="Update odometer" onClick={() => { setNewOdo(''); setOdoOpen(true) }} />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
        {/* ── Odometer + next service ─────────────────────────────────────── */}
        <Card variant="elevated" className="lg:col-span-8 p-5 sm:p-6 md-enter-up">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <div className="type-label-lg text-on-surface-variant flex items-center gap-1.5">
                <Icon name="speed" size={18} /> Odometer
                {est.odo > vehicle.odometer && <span className="font-normal">· estimated today</span>}
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-[3rem] leading-[3.25rem] sm:text-[3.5rem] sm:leading-[4rem] tracking-tight tabular-nums text-on-surface">{est.odo.toLocaleString()}</span>
                <span className="type-title-lg text-on-surface-variant">mi</span>
              </div>
              <p className="type-body text-on-surface-variant mt-1">
                {est.latest ? <>Last reading {mi(est.latest.odo)} on {short(est.latest.date)}</> : 'No readings yet'}
                {driving?.avgPerDay90 ? <> · about {Math.round(driving.avgPerDay90)} mi a day</> : null}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button icon="local_gas_station" onClick={() => open({ kind: 'fuel' })}>Log fuel</Button>
              <Button variant="tonal" icon="build" onClick={() => open({ kind: 'service' })}>Log service</Button>
            </div>
          </div>
          {next && (
            <Link href="/service" className="mt-6 block rounded-xl bg-surface-container-highest/60 hover:bg-surface-container-highest transition-colors p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="type-title text-on-surface truncate">Next: {next.cat.name}</span>
                <Pill tone={next.isOverdue ? 'due' : next.isDueSoon ? 'soon' : 'ok'}>{dueText(next)}</Pill>
              </div>
              <Progress value={next.used} tone={next.isOverdue ? 'error' : next.isDueSoon ? 'warn' : 'primary'} />
              <p className="type-body-sm text-on-surface-variant mt-2">
                {next.lastDate ? `Last done ${short(next.lastDate)} at ${mi(next.lastOdo!)}` : 'Never logged'}
                {next.cat.interval_miles ? ` · every ${next.cat.interval_miles.toLocaleString()} mi` : ''}
                {next.cat.interval_days ? ` or ${Math.round(next.cat.interval_days / 30)} months` : ''}
              </p>
            </Link>
          )}
        </Card>

        {/* ── Needs attention ──────────────────────────────────────────────── */}
        <Card variant="filled" className="lg:col-span-4 lg:self-start py-2 md-enter-up">
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <h2 className="type-title-lg text-on-surface">Needs attention</h2>
            <Button variant="text" size="sm" href="/service" trailingIcon="chevron_right">Schedule</Button>
          </div>
          {loading && !statuses.length ? (
            <div className="px-4 py-3 space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12" />)}</div>
          ) : attention.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-6">
              <Avatar icon="check_circle" tone="success" />
              <div>
                <p className="type-title text-on-surface">All caught up</p>
                <p className="type-body text-on-surface-variant">{next ? `${next.cat.name} is next: ${dueText(next).toLowerCase()}.` : 'Add service categories to get reminders.'}</p>
              </div>
            </div>
          ) : (
            <div>
              {attention.slice(0, 5).map(s => (
                <ListItem key={s.cat.id} dense href="/service"
                  leading={<Avatar icon={s.isOverdue ? 'error' : 'schedule'} tone={s.isOverdue ? 'error' : 'warn'} />}
                  headline={s.cat.name}
                  supporting={s.lastDate ? `Last done ${short(s.lastDate)}` : 'Never logged'}
                  trailing={<Pill tone={s.isOverdue ? 'due' : 'soon'}>{s.isOverdue ? 'Overdue' : 'Soon'}</Pill>} />
              ))}
              {attention.length > 5 && <p className="px-4 py-2 type-body-sm text-on-surface-variant">and {attention.length - 5} more</p>}
            </div>
          )}
        </Card>

        {/* ── Insights ─────────────────────────────────────────────────────── */}
        {derived.insightList.length > 0 && (
          <section className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" aria-label="Insights">
            {derived.insightList.slice(0, 3).map(i => (
              <div key={i.id} className="flex gap-3 items-start rounded-2xl bg-surface-container-low p-4 md-enter-up">
                <Avatar icon={i.icon} tone={i.tone === 'good' ? 'success' : i.tone === 'bad' ? 'warn' : 'primary'} size={36} />
                <p className="type-body-lg text-on-surface min-w-0">{i.text}</p>
              </div>
            ))}
          </section>
        )}

        {/* ── Miles driven ─────────────────────────────────────────────────── */}
        <Card variant="outlined" className="lg:col-span-7 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="type-title-lg text-on-surface">Miles driven</h2>
              <p className="type-body text-on-surface-variant">{driving ? `The 7 days to ${short(driving.through)}, your latest reading` : 'Needs at least two odometer readings'}</p>
            </div>
            {driving && (
              <div className="text-right">
                <div className="type-headline tabular-nums text-on-surface">{Math.round(driving.week).toLocaleString()}<span className="type-body text-on-surface-variant ml-1">mi</span></div>
                <Delta pct={pctChange(driving.week, driving.avg8)} good="none" label="vs your average" />
              </div>
            )}
          </div>
          {driving ? (
            <>
              <div className="mt-4">
                <WeeklyMilesChart weekly={driving.weekly} height={190} />
                <div className="mt-2"><Legend items={[{ label: 'Weekly miles', color: 'var(--data-miles)' }, { label: 'Same week last year', color: 'var(--md-outline)', dashed: true }]} /></div>
              </div>
              <div className="mt-5">
                <CompareBars unit="mi" rows={[
                  { label: 'This week', value: driving.week, emphasis: true, color: 'var(--data-miles)' },
                  { label: 'Week before', value: driving.prevWeek },
                  { label: '8-week average', value: driving.avg8 },
                  { label: 'Same week last year', value: driving.lastYear },
                  { label: `Typical ${format(parseISO(driving.through), 'MMM')} last year`, value: driving.seasonAvg },
                  { label: driving.peak ? `Busiest week (${short(driving.peak.through)})` : 'Busiest week', value: driving.peak?.miles ?? null },
                ]} />
              </div>
            </>
          ) : loading ? <Skeleton className="h-48 mt-4" /> : (
            <EmptyState icon="route" title="No trend yet" body="Log a couple of fill-ups or services with odometer readings and your weekly driving shows up here." />
          )}
        </Card>

        {/* ── Running costs ────────────────────────────────────────────────── */}
        <Card variant="outlined" className="lg:col-span-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="type-title-lg text-on-surface">Running costs</h2>
              <p className="type-body text-on-surface-variant">Fuel and services, {format(new Date(), 'MMMM')} so far</p>
            </div>
            <div className="text-right">
              <div className="type-headline tabular-nums text-on-surface">{usd(spend.thisMonth.total)}</div>
              <Delta pct={pctChange(spend.thisMonth.total, spend.lastMonthSameDays)} good="down" label="vs last month" />
            </div>
          </div>
          <div className="mt-4">
            <MonthlySpendChart months={spend.months} height={190} />
            <div className="mt-2"><Legend items={[{ label: 'Fuel', color: 'var(--data-fuel)' }, { label: 'Services', color: 'var(--data-service)' }, { label: 'Last year', color: 'var(--md-outline)', dashed: true }]} /></div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
            <div>
              <dt className="type-label text-on-surface-variant">Year to date</dt>
              <dd className="type-title-lg tabular-nums text-on-surface">{usd(spend.ytd.total)}</dd>
              <dd><Delta pct={pctChange(spend.ytd.total, spend.ytdLastYear?.total)} good="down" label="vs last year" /></dd>
            </div>
            <div>
              <dt className="type-label text-on-surface-variant">Last 12 months</dt>
              <dd className="type-title-lg tabular-nums text-on-surface">{usd(spend.last12.total)}</dd>
              <dd><Delta pct={pctChange(spend.last12.total, spend.prev12?.total)} good="down" label="vs the 12 before" /></dd>
            </div>
            <div>
              <dt className="type-label text-on-surface-variant">Fuel · services, 12 months</dt>
              <dd className="type-body-lg tabular-nums text-on-surface">{usd(spend.last12.fuel)} · {usd(spend.last12.service)}</dd>
            </div>
            <div>
              <dt className="type-label text-on-surface-variant">Cost per mile</dt>
              <dd className="type-body-lg tabular-nums text-on-surface">
                {derived.costPerMile != null ? `${(derived.costPerMile * 100).toFixed(1)}¢` : '—'}
                {derived.fuelCpm != null && <span className="text-on-surface-variant"> · fuel {(derived.fuelCpm * 100).toFixed(1)}¢</span>}
              </dd>
            </div>
          </dl>
        </Card>

        {/* ── Coming up ────────────────────────────────────────────────────── */}
        <Card variant="outlined" className="lg:col-span-6 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="type-title-lg text-on-surface">Coming up</h2>
              <p className="type-body text-on-surface-variant">Services due, and roughly what they’ll cost</p>
            </div>
            <Segmented size="sm" label="Period" options={PERIODS.map(p => ({ value: p.value, label: p.label }))} value={period} onChange={setPeriod} />
          </div>
          {upcoming.items.length === 0 ? (
            <p className="type-body text-on-surface-variant mt-6">Nothing due in this period.</p>
          ) : (
            <div className="mt-3 -mx-4">
              {upcoming.items.map(({ s, estimate }) => (
                <ListItem key={s.cat.id} dense
                  leading={<Avatar icon={s.isOverdue ? 'error' : 'event_upcoming'} tone={s.isOverdue ? 'error' : 'neutral'} size={36} />}
                  headline={s.cat.name} supporting={dueText(s)}
                  trailing={<span className="text-on-surface">{estimate != null ? `~${usd(estimate)}` : '—'}</span>} />
              ))}
              <div className="flex justify-between items-center px-4 pt-3 mt-1 border-t border-outline-variant">
                <span className="type-title text-on-surface">Estimated total</span>
                <span className="type-title-lg tabular-nums text-on-surface">~{usd(upcoming.total)}</span>
              </div>
            </div>
          )}
        </Card>

        {/* ── Fuel economy ─────────────────────────────────────────────────── */}
        <Card variant="outlined" className="lg:col-span-6 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="type-title-lg text-on-surface">Fuel economy</h2>
            <Button variant="text" size="sm" href="/fuel" trailingIcon="chevron_right">Fuel</Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-surface-container-low p-4 min-w-0">
              <div className="type-label text-on-surface-variant">Last 5 fill-ups</div>
              <div className="flex items-end justify-between gap-2">
                <span className="type-headline-sm tabular-nums text-on-surface">{derived.mpgRecent != null ? derived.mpgRecent.toFixed(1) : '—'}<span className="type-body text-on-surface-variant ml-1">mpg</span></span>
                <span className="max-sm:hidden"><Sparkline values={derived.mpgSpark} color="var(--data-fuel)" width={72} height={28} /></span>
              </div>
              <Delta pct={pctChange(derived.mpgRecent, derived.mpgBefore)} good="up" label="vs the 5 before" />
            </div>
            <div className="rounded-xl bg-surface-container-low p-4 min-w-0">
              <div className="type-label text-on-surface-variant">Fuel this month</div>
              <span className="type-headline-sm tabular-nums text-on-surface">{usd(spend.thisMonth.fuel)}</span>
              <p className="type-body-sm text-on-surface-variant">{derived.forecast ? `About ${usd(derived.forecast.projected)} by month end` : 'Projection after 2 fill-ups'}</p>
            </div>
          </div>
          {derived.leftOnTable > 0.5 && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-success-container/60 p-4">
              <Avatar icon="eco" tone="success" size={36} />
              <p className="type-body text-on-surface min-w-0">
                <span className="type-title tabular-nums">{usd(derived.leftOnTable)}</span> left on the table by not matching your best mpg each season
                {derived.firstFuel && <span className="text-on-surface-variant"> · since {format(parseISO(derived.firstFuel), 'MMM yyyy')}</span>}
              </p>
            </div>
          )}
        </Card>

        {/* ── Recent ───────────────────────────────────────────────────────── */}
        <Card variant="outlined" className="lg:col-span-12 py-2">
          <div className="flex items-center justify-between px-4 sm:px-5 pt-3 pb-1">
            <h2 className="type-title-lg text-on-surface">Recent</h2>
          </div>
          {recent.length === 0 && !loading ? (
            <EmptyState icon="history" title="Nothing logged yet" body="Your fill-ups and services will show up here."
              action={<Button icon="add" onClick={() => open({ kind: 'fuel' })}>Log your first fill-up</Button>} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-4">
              {recent.map(r => (
                <ListItem key={r.id} href={r.href} dense
                  leading={<Avatar icon={r.icon} tone={r.tone} />}
                  headline={r.title}
                  supporting={`${format(parseISO(r.date), 'EEE, MMM d')} · ${r.sub}`}
                  trailing={r.amount != null ? <span className="text-on-surface">{usd(Number(r.amount), true)}</span> : undefined} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <Dialog open={odoOpen} onClose={() => setOdoOpen(false)} title="Update odometer" variant="basic" size="sm"
        primary={{ label: 'Save', onClick: saveOdometer, disabled: !newOdo || odoLow, loading: odoSaving }}>
        <p className="mb-5">What does the dashboard read now? Fill-ups and services update it on their own.</p>
        <TextField label="Odometer" suffix="mi" inputMode="numeric" type="number" autoFocus value={newOdo} onChange={e => setNewOdo(e.target.value)}
          error={odoLow ? `Can’t go below the current ${mi(vehicle.odometer)}.` : undefined}
          helper={!odoLow ? `Currently ${mi(vehicle.odometer)}` : undefined} />
      </Dialog>
    </Page>
  )
}
