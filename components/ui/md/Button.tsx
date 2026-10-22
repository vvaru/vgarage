'use client'

import Link from 'next/link'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import Icon, { type IconName } from '../Icon'

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated' | 'danger' | 'danger-filled'
type Size = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  filled: 'bg-primary text-on-primary hover:shadow-elev-1',
  tonal: 'bg-secondary-container text-on-secondary-container hover:shadow-elev-1',
  outlined: 'border border-outline text-primary',
  text: 'text-primary',
  elevated: 'bg-surface-container-low text-primary shadow-elev-1 hover:shadow-elev-2',
  danger: 'text-error',
  'danger-filled': 'bg-error text-on-error hover:shadow-elev-1',
}
const SIZE: Record<Size, string> = {
  sm: 'h-8 px-3 gap-1.5 type-label-lg',
  md: 'h-10 px-6 gap-2 type-label-lg',
  lg: 'h-12 px-7 gap-2 text-base font-medium',
}
const ICON_SIZE: Record<Size, number> = { sm: 18, md: 18, lg: 20 }

export function buttonClass(variant: ButtonVariant = 'filled', size: Size = 'md', extra = '') {
  // A state layer (::before) gives every button the same hover/press feedback.
  return [
    'relative inline-flex items-center justify-center rounded-full select-none whitespace-nowrap overflow-hidden',
    'transition-[box-shadow,background-color] duration-150',
    'before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.08] active:before:opacity-[0.12] before:transition-opacity',
    'disabled:opacity-40 disabled:pointer-events-none',
    variant === 'text' || variant === 'danger' ? (size === 'sm' ? 'px-2' : 'px-3') : '',
    VARIANT[variant], SIZE[size], extra,
  ].join(' ')
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: Size
  icon?: IconName
  trailingIcon?: IconName
  loading?: boolean
  href?: string
  children?: ReactNode
}

export default function Button({ variant = 'filled', size = 'md', icon, trailingIcon, loading, href, className = '', children, disabled, ...rest }: Props) {
  const inner = (
    <>
      {loading
        ? <Icon name="progress_activity" size={ICON_SIZE[size]} className="animate-spin -ml-1" />
        : icon && <Icon name={icon} size={ICON_SIZE[size]} className={children ? '-ml-1' : ''} />}
      {children && <span className="relative">{children}</span>}
      {trailingIcon && <Icon name={trailingIcon} size={ICON_SIZE[size]} className="-mr-1" />}
    </>
  )
  if (href) return <Link href={href} className={buttonClass(variant, size, className)}>{inner}</Link>
  return (
    <button type="button" disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {inner}
    </button>
  )
}

type IconVariant = 'standard' | 'filled' | 'tonal' | 'outlined'
const ICON_VARIANT: Record<IconVariant, string> = {
  standard: 'text-on-surface-variant',
  filled: 'bg-primary text-on-primary',
  tonal: 'bg-secondary-container text-on-secondary-container',
  outlined: 'border border-outline-variant text-on-surface-variant',
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  label: string
  variant?: IconVariant
  size?: 'sm' | 'md'
  selected?: boolean
  href?: string
}

export function IconButton({ icon, label, variant = 'standard', size = 'md', selected, href, className = '', ...rest }: IconButtonProps) {
  const cls = [
    'relative inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden',
    'before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.08] active:before:opacity-[0.12] before:transition-opacity',
    'disabled:opacity-40 disabled:pointer-events-none',
    size === 'sm' ? 'w-8 h-8' : 'w-10 h-10',
    selected ? 'bg-secondary-container text-on-secondary-container' : ICON_VARIANT[variant],
    className,
  ].join(' ')
  const glyph = <Icon name={icon} size={size === 'sm' ? 18 : 22} fill={selected} />
  if (href) return <Link href={href} aria-label={label} title={label} className={cls}>{glyph}</Link>
  return <button type="button" aria-label={label} title={label} className={cls} {...rest}>{glyph}</button>
}
