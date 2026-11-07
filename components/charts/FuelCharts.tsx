'use client'

import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DrivingMode } from '@/lib/fuelAnalytics'
import { ChartBox, TipCard } from './TrendCharts'

const AXIS = { fontSize: 11, fill: 'var(--md-on-surface-variant)' }

export const MODE_COLORS: Record<DrivingMode, string> = {
  efficient: 'var(--md-success)',
  aggressive: 'var(--md-error)',
  mixed: 'var(--md-outline)',
}

export interface SeriesPoint { date: string; value: number; mode?: DrivingMode | null }

/** One value over time. */
export function FuelLine({ data, name, fmt, tickFmt, color = 'var(--data-fuel)', height = 260 }: {
  data: SeriesPoint[]; name: string; fmt: (n: number) => string; tickFmt?: (n: number) => string; color?: string; height?: number
}) {
  return (
    <ChartBox height={height}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--data-grid)" />
          <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} domain={['auto', 'auto']} tickFormatter={v => (tickFmt ? tickFmt(Number(v)) : String(Math.round(Number(v))))} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as SeriesPoint
            return <TipCard title={p.date} rows={[{ name, value: p.value, color, fmt }]} />
          }} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 2.5, fill: color, strokeWidth: 0 }} activeDot={{ r: 5, strokeWidth: 0 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function ModeDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: SeriesPoint }) {
  if (cx == null || cy == null) return null
  const mode = payload?.mode ?? 'mixed'
  const loud = mode !== 'mixed'
  return <circle cx={cx} cy={cy} r={loud ? 5 : 3.5} fill={MODE_COLORS[mode]} opacity={loud ? 1 : 0.6} />
}

/** MPG per fill-up, coloured by how it was driven, with each mode's average as a dashed line. */
export function FuelModes({ data, efficientAvg, aggressiveAvg, height = 260 }: {
  data: SeriesPoint[]; efficientAvg: number | null; aggressiveAvg: number | null; height?: number
}) {
  return (
    <ChartBox height={height}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height }}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="var(--data-grid)" />
          <XAxis dataKey="date" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} domain={['auto', 'auto']} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as SeriesPoint
            return <TipCard title={p.date} rows={[{ name: 'MPG', value: p.value, color: MODE_COLORS[p.mode ?? 'mixed'], fmt: n => n.toFixed(1) }]} />
          }} />
          {efficientAvg != null && <ReferenceLine y={efficientAvg} stroke={MODE_COLORS.efficient} strokeDasharray="5 4" strokeWidth={1.5} />}
          {aggressiveAvg != null && <ReferenceLine y={aggressiveAvg} stroke={MODE_COLORS.aggressive} strokeDasharray="5 4" strokeWidth={1.5} />}
          <Line type="linear" dataKey="value" stroke="var(--md-outline-variant)" strokeWidth={1} strokeDasharray="2 3" dot={<ModeDot />} activeDot={{ r: 6, strokeWidth: 0 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

/** A small month-by-month bar strip. */
export function MonthBars({ data, name, fmt, color = 'var(--md-success)', height = 72 }: {
  data: { label: string; value: number }[]; name: string; fmt: (n: number) => string; color?: string; height?: number
}) {
  return (
    <ChartBox height={height}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 240, height }}>
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" tick={{ ...AXIS, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <Tooltip cursor={{ fill: 'var(--md-on-surface)', opacity: 0.06 }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as { label: string; value: number }
            return <TipCard title={p.label} rows={[{ name, value: p.value, color, fmt }]} />
          }} />
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}
