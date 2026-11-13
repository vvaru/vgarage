'use client'

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import Icon from '../Icon'

// Material 3 outlined text fields. The label sits in the border once the field has
// a value or focus; its background follows --field-bg, which surfaces such as
// dialogs set to their own colour so the notch blends in.
const shell = 'relative block min-w-0'
const box = [
  'peer w-full min-w-0 bg-transparent rounded-[4px] border border-outline text-on-surface type-body-lg',
  'outline-none transition-colors hover:border-on-surface focus:border-primary focus:border-2',
  'disabled:opacity-50 disabled:hover:border-outline',
].join(' ')
const labelCls = [
  'pointer-events-none absolute left-3 px-1 text-on-surface-variant transition-all duration-150 origin-left',
  'bg-[var(--field-bg,var(--md-surface-container-low))] rounded-sm max-w-[calc(100%-1.5rem)] truncate',
].join(' ')

interface Common {
  label: string
  helper?: ReactNode
  error?: ReactNode
  prefix?: string
  suffix?: string
  className?: string
}

function Helper({ helper, error }: { helper?: ReactNode; error?: ReactNode }) {
  if (!helper && !error) return null
  return (
    <span className={`mt-1 px-4 type-body-sm flex gap-1 items-start ${error ? 'text-error' : 'text-on-surface-variant'}`}>
      {error && <Icon name="error" size={14} fill className="mt-px" />}
      <span className="min-w-0">{error || helper}</span>
    </span>
  )
}

export const TextField = forwardRef<HTMLInputElement, Common & Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'>>(
  function TextField({ label, helper, error, prefix, suffix, className = '', id, placeholder, type = 'text', ...rest }, ref) {
    const auto = useId()
    const fid = id ?? auto
    // Labels float permanently when there's a placeholder to show or the input has
    // native chrome (date pickers); otherwise they rest inside until focused/filled.
    const alwaysUp = Boolean(placeholder) || type === 'date' || type === 'time' || type === 'month' || Boolean(prefix)
    return (
      <span className={`flex flex-col ${className}`}>
        <span className={shell}>
          {prefix && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant type-body-lg pointer-events-none">{prefix}</span>}
          <input
            ref={ref} id={fid} type={type} placeholder={placeholder ?? ' '} aria-invalid={Boolean(error) || undefined}
            className={`${box} h-14 ${prefix ? 'pl-8' : 'pl-4'} ${suffix ? 'pr-12' : 'pr-4'} placeholder:text-on-surface-variant/60 ${error ? '!border-error !border-2' : ''} tabular-nums`}
            {...rest}
          />
          <label htmlFor={fid}
            className={`${labelCls} ${error ? '!text-error' : ''} peer-focus:text-primary ${alwaysUp
              ? '-top-2 type-body-sm'
              : 'top-1/2 -translate-y-1/2 type-body-lg peer-focus:top-0 peer-focus:type-body-sm peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:type-body-sm'}`}>
            {label}
          </label>
          {suffix && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant type-body pointer-events-none">{suffix}</span>}
        </span>
        <Helper helper={helper} error={error} />
      </span>
    )
  },
)

export function SelectField({ label, helper, error, className = '', id, children, ...rest }: Common & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <span className={`flex flex-col ${className}`}>
      <span className={shell}>
        <select id={fid} className={`${box} h-14 pl-4 pr-10 appearance-none cursor-pointer ${error ? '!border-error !border-2' : ''}`} {...rest}>
          {children}
        </select>
        <label htmlFor={fid} className={`${labelCls} -top-2 type-body-sm peer-focus:text-primary ${error ? '!text-error' : ''}`}>{label}</label>
        <Icon name="arrow_drop_down" size={24} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
      </span>
      <Helper helper={helper} error={error} />
    </span>
  )
}

export function TextArea({ label, helper, error, className = '', id, rows = 3, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <span className={`flex flex-col ${className}`}>
      <span className={shell}>
        <textarea id={fid} rows={rows} placeholder=" " className={`${box} px-4 pt-4 pb-3 resize-none`} {...rest} />
        <label htmlFor={fid}
          className={`${labelCls} top-4 type-body-lg peer-focus:-top-2 peer-focus:type-body-sm peer-focus:text-primary peer-[:not(:placeholder-shown)]:-top-2 peer-[:not(:placeholder-shown)]:type-body-sm`}>
          {label}
        </label>
      </span>
      <Helper helper={helper} error={error} />
    </span>
  )
}

/** A read-only value shaped like a field, for numbers the form works out itself. */
export function ReadoutField({ label, value, tone, className = '' }: { label: string; value: ReactNode; tone?: 'good'; className?: string }) {
  return (
    <span className={`flex flex-col justify-center h-14 px-4 rounded-[4px] bg-surface-container-highest min-w-0 ${className}`}>
      <span className="type-body-sm text-on-surface-variant truncate">{label}</span>
      <span className={`type-body-lg tabular-nums truncate ${tone === 'good' ? 'text-[var(--md-success)]' : 'text-on-surface'}`}>{value}</span>
    </span>
  )
}
