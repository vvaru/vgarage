'use client'

import type { ReactNode } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { monthLabel } from '@/lib/trends'

const AXIS = { fontSize: 11, fill: 'var(--md-on-surface-variant)' }
const fmtShort = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Fixed-height box so the responsive chart always has a size to measure. */
export function ChartBox({ height = 200, children }: { height?: number; children: ReactNode }) {
  return <div className="w-full min-w-0" style={{ height }}>{children}</div>
}

interface TipRow { name: string; value: number | null; color: string; fmt: (n: number) => string }
export function TipCard({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="rounded-lg bg-inverse-surface text-inverse-on-surface px-3 py-2 shadow-elev-2 min-w-36">
      <p className="type-label mb-1 opacity-80">{title}</p>
      {rows.filter(r => r.value != null).map(r => (
        <p key={r.name} className="type-body flex items-center gap-2 tabular-nums">
          <span className="w-2 h-2 rounded-full" style={{ background: r.color }} />
          <span className="flex-1">{r.name}</span>
          <span className="font-medium">{r.fmt(r.value!)}</span>
        </p>
      ))}
    </div>
  )
}

const milesFmt = (n: number) => `${Math.round(n).toLocaleString()} mi`
const usdFmt = (n: number) => `$${n.toFixed(0)}`

/** Weekly miles (bars) with the same weeks last year (dashed line). */
export function WeeklyMilesChart({ weekly, height = 200 }: { weekly: { through: string; miles: number; lastYear: number | null }[]; height?: number }) {
  const data = weekly.map(w => ({ ...w, label: fmtShort(w.through) }))
  const hasLy = data.some(d => d.lastYear != null)
  return (
    <ChartBox height={height}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--data-grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={{ fill: 'var(--md-on-surface)', opacity: 0.06 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as (typeof data)[number]
            return <TipCard title={`7 days to ${p.label}`} rows={[
              { name: 'Miles', value: p.miles, color: 'var(--data-miles)', fmt: milesFmt },
              { name: 'Last year', value: p.lastYear, color: 'var(--md-outline)', fmt: milesFmt },
            ]} />
          }} />
          <Bar dataKey="miles" fill="var(--data-miles)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          {hasLy && <Line dataKey="lastYear" type="monotone" stroke="var(--md-outline)" strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

/** Monthly running costs: fuel and services stacked, last year's total as a dashed line. */
export function MonthlySpendChart({ months, height = 200 }: { months: { month: string; fuel: number; service: number; lastYear: number | null }[]; height?: number }) {
  const data = months.map(m => ({ ...m, label: monthLabel(m.month) }))
  const hasLy = data.some(d => d.lastYear != null)
  return (
    <ChartBox height={height}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke="var(--data-grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={v => `$${v}`} />
          <Tooltip cursor={{ fill: 'var(--md-on-surface)', opacity: 0.06 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as (typeof data)[number]
            return <TipCard title={monthLabel(p.month, true)} rows={[
              { name: 'Fuel', value: p.fuel, color: 'var(--data-fuel)', fmt: usdFmt },
              { name: 'Services', value: p.service, color: 'var(--data-service)', fmt: usdFmt },
              { name: 'Total', value: p.fuel + p.service, color: 'transparent', fmt: usdFmt },
              { name: 'Last year', value: p.lastYear, color: 'var(--md-outline)', fmt: usdFmt },
            ]} />
          }} />
          <Bar dataKey="fuel" stackId="s" fill="var(--data-fuel)" isAnimationActive={false} />
          <Bar dataKey="service" stackId="s" fill="var(--data-service)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          {hasLy && <Line dataKey="lastYear" type="monotone" stroke="var(--md-outline)" strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

/** Monthly miles with last year alongside. */
export function MonthlyMilesChart({ monthly, height = 200 }: { monthly: { month: string; miles: number; lastYear: number | null; partial: boolean }[]; height?: number }) {
  const data = monthly.map(m => ({ ...m, label: monthLabel(m.month) + (m.partial ? '*' : '') }))
  return (
    <ChartBox height={height}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -12 }} barCategoryGap="18%" barGap={2}>
          <CartesianGrid vertical={false} stroke="var(--data-grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={{ fill: 'var(--md-on-surface)', opacity: 0.06 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as (typeof data)[number]
            return <TipCard title={monthLabel(p.month, true) + (p.partial ? ' (so far)' : '')} rows={[
              { name: 'Miles', value: p.miles, color: 'var(--data-miles)', fmt: milesFmt },
              { name: 'Last year', value: p.lastYear, color: 'var(--md-outline-variant)', fmt: milesFmt },
            ]} />
          }} />
          <Bar dataKey="lastYear" fill="var(--md-outline-variant)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="miles" fill="var(--data-miles)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

/** Small legend row for the charts above. */
export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 type-body-sm text-on-surface-variant">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed
            ? <span className="w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} />
            : <span className="w-2.5 h-2.5 rounded-sm" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  )
}
