'use client'

import type { ReactNode } from 'react'
import Icon, { type IconName } from '../Icon'

/* ── Sparkline ────────────────────────────────────────────────────────────── */
export function Sparkline({ values, color = 'var(--md-primary)', height = 32, width = 120, fill = true, highlightLast = true }: {
  values: number[]; color?: string; height?: number; width?: number; fill?: boolean; highlightLast?: boolean
}) {
  if (values.length < 2) return null
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const pad = 3
  const pts = values.map((v, i) => [pad + (i / (values.length - 1)) * (width - 2 * pad), pad + (1 - (v - min) / span) * (height - 2 * pad)] as const)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
  const last = pts[pts.length - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block overflow-visible" aria-hidden>
      {fill && <path d={`${d}L${last[0]},${height}L${pts[0][0]},${height}Z`} fill={color} opacity={0.14} />}
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {highlightLast && <circle cx={last[0]} cy={last[1]} r={3} fill={color} />}
    </svg>
  )
}

/* ── Change versus a baseline ─────────────────────────────────────────────── */
// `good` says which direction is good news (spending less, driving more efficiently…);
// direction alone is neutral information.
export function Delta({ pct, good, label, className = '' }: { pct: number | null; good?: 'up' | 'down' | 'none'; label?: string; className?: string }) {
  if (pct == null || !isFinite(pct)) return null
  const flat = Math.abs(pct) < 2
  const up = pct > 0
  const tone = flat || good === 'none' || !good ? 'text-on-surface-variant'
    : (up === (good === 'up')) ? 'text-[var(--md-success)]' : 'text-error'
  const icon: IconName = flat ? 'trending_flat' : up ? 'trending_up' : 'trending_down'
  return (
    <span className={`inline-flex items-center gap-1 type-label tabular-nums ${tone} ${className}`}>
      <Icon name={icon} size={16} />
      {flat ? 'About the same' : `${up ? '+' : '−'}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`}
      {label && <span className="text-on-surface-variant font-normal">{label}</span>}
    </span>
  )
}

/* ── Metric ───────────────────────────────────────────────────────────────── */
export function Metric({ label, value, unit, sub, delta, spark, icon, tone, className = '' }: {
  label: string
  value: ReactNode
  unit?: string
  sub?: ReactNode
  delta?: ReactNode
  spark?: ReactNode
  icon?: IconName
  tone?: string
  className?: string
}) {
  return (
    <div className={`rounded-2xl bg-surface-container-low p-4 flex flex-col gap-1 min-w-0 ${className}`}>
      <div className="flex items-center gap-1.5 text-on-surface-variant">
        {icon && <Icon name={icon} size={18} style={tone ? { color: tone } : undefined} />}
        <span className="type-label-lg truncate">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <span className="type-headline-sm sm:type-headline text-on-surface tabular-nums">{value}</span>
          {unit && <span className="type-body text-on-surface-variant ml-1">{unit}</span>}
        </div>
        {spark && <div className="shrink-0 mb-1">{spark}</div>}
      </div>
      {(delta || sub) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 type-body-sm text-on-surface-variant">
          {delta}
          {sub && <span className="min-w-0">{sub}</span>}
        </div>
      )}
    </div>
  )
}

/* ── Horizontal comparison bars ───────────────────────────────────────────── */
// "This week vs …": each row a labelled bar on one shared scale.
export function CompareBars({ rows, unit, format = n => Math.round(n).toLocaleString() }: {
  rows: { label: string; value: number | null; color?: string; emphasis?: boolean; note?: string }[]
  unit?: string
  format?: (n: number) => string
}) {
  const max = Math.max(1, ...rows.map(r => r.value ?? 0))
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,9.5rem)_1fr_auto] items-center gap-3">
          <span className={`type-body truncate ${r.emphasis ? 'text-on-surface font-medium' : 'text-on-surface-variant'}`}>{r.label}</span>
          <span className="h-3 rounded-full bg-surface-container-highest overflow-hidden">
            {r.value != null && (
              <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: r.color ?? (r.emphasis ? 'var(--md-primary)' : 'var(--md-outline)') }} />
            )}
          </span>
          <span className={`type-label-lg tabular-nums text-right ${r.emphasis ? 'text-on-surface' : 'text-on-surface-variant'}`}>
            {r.value == null ? '—' : `${format(r.value)}${unit ? ` ${unit}` : ''}`}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Progress bar with M3 track. */
export function Progress({ value, tone = 'primary', className = '' }: { value: number; tone?: 'primary' | 'error' | 'warn' | 'success'; className?: string }) {
  const c = { primary: 'var(--md-primary)', error: 'var(--md-error)', warn: 'var(--md-warn)', success: 'var(--md-success)' }[tone]
  return (
    <div className={`h-1 rounded-full bg-surface-container-highest overflow-hidden ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: c }} />
    </div>
  )
}
