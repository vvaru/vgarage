'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import Icon, { type IconName } from '../Icon'

const stateLayer = 'before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.08] active:before:opacity-[0.12] before:transition-opacity before:pointer-events-none'

/* ── Segmented button ─────────────────────────────────────────────────────── */
export function Segmented<T extends string>({ options, value, onChange, size = 'md', className = '', label }: {
  options: { value: T; label: string; icon?: IconName }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
  label?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`inline-grid grid-flow-col auto-cols-fr rounded-full border border-outline overflow-hidden ${size === 'sm' ? 'h-8' : 'h-10'} ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`relative flex items-center justify-center gap-1.5 px-3 type-label-lg whitespace-nowrap ${stateLayer}
              ${i > 0 ? 'border-l border-outline' : ''} ${on ? 'bg-secondary-container text-on-secondary-container' : 'text-on-surface'}`}>
            {on ? <Icon name="check" size={18} /> : o.icon && <Icon name={o.icon} size={18} />}
            <span>{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Chips ────────────────────────────────────────────────────────────────── */
export function Chip({ selected, onClick, icon, children, onRemove, className = '' }: {
  selected?: boolean
  onClick?: () => void
  icon?: IconName
  children: ReactNode
  onRemove?: () => void
  className?: string
}) {
  return (
    <span className={`relative inline-flex items-center h-8 rounded-lg type-label-lg shrink-0 overflow-hidden ${selected
      ? 'bg-secondary-container text-on-secondary-container'
      : 'border border-outline-variant text-on-surface-variant'} ${className}`}>
      <button type="button" onClick={onClick} aria-pressed={selected}
        className={`relative inline-flex items-center gap-1.5 h-full ${stateLayer} ${selected || icon ? 'pl-2' : 'pl-4'} ${onRemove ? 'pr-1' : 'pr-4'}`}>
        {selected ? <Icon name="check" size={18} /> : icon && <Icon name={icon} size={18} />}
        <span className="whitespace-nowrap">{children}</span>
      </button>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove" className={`relative h-full pr-2 pl-1 ${stateLayer}`}>
          <Icon name="close" size={16} />
        </button>
      )}
    </span>
  )
}

/* ── Cards ────────────────────────────────────────────────────────────────── */
type CardVariant = 'filled' | 'elevated' | 'outlined' | 'plain'
const CARD: Record<CardVariant, string> = {
  filled: 'bg-surface-container-highest',
  elevated: 'bg-surface-container-low shadow-elev-1',
  outlined: 'bg-surface border border-outline-variant',
  plain: 'bg-surface-container',
}
export function Card({ variant = 'outlined', className = '', children, onClick, href }: {
  variant?: CardVariant
  className?: string
  children: ReactNode
  onClick?: () => void
  href?: string
}) {
  const cls = `relative rounded-2xl ${CARD[variant]} ${onClick || href ? `text-left overflow-hidden ${stateLayer}` : ''} ${className}`
  if (href) return <Link href={href} className={`block ${cls}`}>{children}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={`block w-full ${cls}`}>{children}</button>
  return <div className={cls}>{children}</div>
}

/* ── List item ────────────────────────────────────────────────────────────── */
export function ListItem({ leading, headline, supporting, trailing, onClick, href, selected, className = '', dense }: {
  leading?: ReactNode
  headline: ReactNode
  supporting?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  href?: string
  selected?: boolean
  className?: string
  dense?: boolean
}) {
  const body = (
    <>
      {leading && <span className="shrink-0 flex items-center">{leading}</span>}
      <span className="flex-1 min-w-0">
        <span className="block type-body-lg text-on-surface truncate">{headline}</span>
        {supporting && <span className="block type-body text-on-surface-variant truncate">{supporting}</span>}
      </span>
      {trailing && <span className="shrink-0 flex items-center gap-2 type-label-lg text-on-surface-variant tabular-nums">{trailing}</span>}
    </>
  )
  const cls = `relative flex items-center gap-4 w-full text-left px-4 ${dense ? 'py-2 min-h-14' : 'py-3 min-h-[72px]'} ${selected ? 'bg-secondary-container [&_*]:!text-on-secondary-container' : ''} ${className}`
  if (href) return <Link href={href} className={`${cls} ${stateLayer}`}>{body}</Link>
  if (onClick) return <button type="button" onClick={onClick} className={`${cls} ${stateLayer}`}>{body}</button>
  return <div className={cls}>{body}</div>
}

/** A round icon tile used as a list item's leading element. */
export function Avatar({ icon, tone = 'primary', size = 40 }: { icon: IconName; tone?: 'primary' | 'secondary' | 'tertiary' | 'error' | 'success' | 'warn' | 'fuel' | 'neutral'; size?: number }) {
  const t: Record<string, string> = {
    primary: 'bg-primary-container text-on-primary-container',
    secondary: 'bg-secondary-container text-on-secondary-container',
    tertiary: 'bg-tertiary-container text-on-tertiary-container',
    error: 'bg-error-container text-on-error-container',
    success: 'bg-success-container text-on-success-container',
    warn: 'bg-warn-container text-on-warn-container',
    fuel: 'bg-[color-mix(in_oklab,var(--data-fuel)_22%,var(--md-surface))] text-[var(--data-fuel)]',
    neutral: 'bg-surface-container-highest text-on-surface-variant',
  }
  return (
    <span className={`inline-flex items-center justify-center rounded-full shrink-0 ${t[tone]}`} style={{ width: size, height: size }}>
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </span>
  )
}

/* ── Tabs (primary) ───────────────────────────────────────────────────────── */
export function Tabs<T extends string>({ tabs, value, onChange, className = '' }: {
  tabs: { value: T; label: string; icon?: IconName; badge?: number }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div role="tablist" className={`flex border-b border-outline-variant overflow-x-auto scrollbar-hide ${className}`}>
      {tabs.map(t => {
        const on = t.value === value
        return (
          <button key={t.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.value)}
            className={`relative flex-1 min-w-fit px-4 h-12 flex items-center justify-center gap-2 type-title-sm ${stateLayer} ${on ? 'text-primary' : 'text-on-surface-variant'}`}>
            {t.icon && <Icon name={t.icon} size={20} fill={on} />}
            <span className="whitespace-nowrap">{t.label}</span>
            {t.badge ? <span className="min-w-4 h-4 px-1 rounded-full bg-error text-on-error type-label-sm leading-4">{t.badge}</span> : null}
            {on && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-full max-w-24 rounded-t-full bg-primary" />}
          </button>
        )
      })}
    </div>
  )
}

/* ── Status pill ──────────────────────────────────────────────────────────── */
export type Tone = 'ok' | 'soon' | 'due' | 'info' | 'neutral'
const PILL: Record<Tone, string> = {
  ok: 'bg-success-container text-on-success-container',
  soon: 'bg-warn-container text-on-warn-container',
  due: 'bg-error-container text-on-error-container',
  info: 'bg-primary-container text-on-primary-container',
  neutral: 'bg-surface-container-highest text-on-surface-variant',
}
export function Pill({ tone = 'neutral', icon, children, className = '' }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-md type-label whitespace-nowrap ${PILL[tone]} ${className}`}>
      {icon && <Icon name={icon} size={14} fill />}
      {children}
    </span>
  )
}

/* ── Section header ───────────────────────────────────────────────────────── */
export function SectionHeader({ title, subtitle, action, className = '' }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="type-title-lg text-on-surface">{title}</h2>
        {subtitle && <p className="type-body text-on-surface-variant mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ── Divider, skeleton, empty state ───────────────────────────────────────── */
export const Divider = ({ inset = false, className = '' }: { inset?: boolean; className?: string }) =>
  <div role="separator" className={`h-px bg-outline-variant ${inset ? 'ml-[72px] mr-4' : ''} ${className}`} />

export const Skeleton = ({ className = '' }: { className?: string }) => <div className={`md-skeleton rounded-lg ${className}`} />

export function EmptyState({ icon, title, body, action, className = '' }: { icon: IconName; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col items-center text-center px-6 py-12 ${className}`}>
      <span className="w-16 h-16 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-variant mb-4">
        <Icon name={icon} size={30} />
      </span>
      <p className="type-title text-on-surface">{title}</p>
      {body && <p className="type-body text-on-surface-variant mt-1 max-w-sm">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
