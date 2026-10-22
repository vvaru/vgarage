'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon'
import Button, { IconButton } from './Button'

/* ── Body scroll lock shared by every open overlay ───────────────────────── */
let locks = 0
function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    if (locks++ === 0) document.documentElement.style.overflow = 'hidden'
    return () => { if (--locks === 0) document.documentElement.style.overflow = '' }
  }, [active])
}

const noop = () => () => {}
function Portal({ children }: { children: ReactNode }) {
  // Only on the client (the static export renders without a document).
  const mounted = useSyncExternalStore(noop, () => true, () => false)
  return mounted ? createPortal(children, document.body) : null
}

/* ── Dialog ───────────────────────────────────────────────────────────────── */
// "form": full-screen on phones (title bar with close + primary action), a centred
// dialog with a footer on wider screens. "basic": a small centred dialog everywhere.
export function Dialog({ open, onClose, title, subtitle, children, primary, secondary, variant = 'form', size = 'md', dismissible = true, headerExtra }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  primary?: { label: string; onClick: () => void; disabled?: boolean; loading?: boolean; danger?: boolean }
  secondary?: { label: string; onClick: () => void }
  variant?: 'form' | 'basic'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  dismissible?: boolean
  headerExtra?: ReactNode
}) {
  useScrollLock(open)
  useEffect(() => {
    if (!open || !dismissible) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, dismissible, onClose])
  if (!open) return null
  const width = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size]
  const fieldBg = { '--field-bg': 'var(--md-surface-container-high)' } as CSSProperties
  const fieldBgPhone = variant === 'form' ? 'max-sm:[--field-bg:var(--md-surface)]' : ''

  return (
    <Portal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center sm:p-6 md-fade" style={{ background: 'var(--md-scrim)' }}
        onMouseDown={e => { if (dismissible && e.target === e.currentTarget) onClose() }}>
        <div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={fieldBg}
          className={`relative flex flex-col w-full ${width} md-scale overflow-hidden ${fieldBgPhone} ${variant === 'form'
            ? 'max-sm:h-full max-sm:bg-surface sm:max-h-[min(860px,calc(100vh-48px))] sm:rounded-[28px] bg-surface-container-high'
            : 'max-w-[calc(100%-48px)] max-h-[calc(100%-48px)] rounded-[28px] bg-surface-container-high'}`}>
          {variant === 'form' ? (
            <div className="flex items-center gap-1 pl-1 pr-2 sm:pl-6 sm:pr-3 pt-[max(8px,env(safe-area-inset-top))] sm:pt-5 pb-2 shrink-0">
              <IconButton icon="close" label="Close" onClick={onClose} className="sm:hidden" />
              <div className="flex-1 min-w-0 pl-1 sm:pl-0">
                <h2 className="type-title-lg sm:type-headline-sm text-on-surface truncate">{title}</h2>
                {subtitle && <p className="type-body text-on-surface-variant truncate">{subtitle}</p>}
              </div>
              {headerExtra}
              {primary && (
                <Button variant="text" className="sm:hidden" onClick={primary.onClick} disabled={primary.disabled} loading={primary.loading}>{primary.label}</Button>
              )}
              <IconButton icon="close" label="Close" onClick={onClose} className="max-sm:hidden" />
            </div>
          ) : (
            <div className="px-6 pt-6 pb-2">
              <h2 className="type-headline-sm text-on-surface">{title}</h2>
              {subtitle && <p className="type-body text-on-surface-variant mt-1">{subtitle}</p>}
            </div>
          )}
          <div className={`flex-1 min-h-0 overflow-y-auto ${variant === 'form' ? 'px-4 sm:px-6 pt-3 pb-[max(24px,env(safe-area-inset-bottom))] sm:pb-6' : 'px-6 py-3 type-body text-on-surface-variant'}`}>
            {children}
          </div>
          {(primary || secondary) && (
            <div className={`flex justify-end gap-2 px-6 pb-6 pt-2 shrink-0 ${variant === 'form' ? 'max-sm:hidden' : ''}`}>
              <Button variant="text" onClick={secondary?.onClick ?? onClose}>{secondary?.label ?? 'Cancel'}</Button>
              {primary && (
                <Button variant={primary.danger ? 'danger-filled' : 'filled'} onClick={primary.onClick} disabled={primary.disabled} loading={primary.loading}>{primary.label}</Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Portal>
  )
}

/** Yes/no confirmation built on the basic dialog. */
export function Confirm({ open, title, body, confirmLabel, danger, onConfirm, onCancel, busy }: {
  open: boolean; title: string; body?: ReactNode; confirmLabel: string; danger?: boolean
  onConfirm: () => void; onCancel: () => void; busy?: boolean
}) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} variant="basic" size="sm"
      primary={{ label: confirmLabel, onClick: onConfirm, danger, loading: busy }}>
      {body}
    </Dialog>
  )
}

/* ── Menu ─────────────────────────────────────────────────────────────────── */
export interface MenuItem { label: string; icon?: Parameters<typeof Icon>[0]['name']; onClick: () => void; supporting?: string; danger?: boolean; selected?: boolean }

export function Menu({ trigger, items, align = 'end', className = '' }: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  items: MenuItem[]
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div ref={ref} className={`relative ${className}`}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div role="menu" className={`absolute z-50 mt-1 min-w-56 max-w-[min(320px,calc(100vw-32px))] py-2 rounded-xl bg-surface-container shadow-elev-2 md-scale ${align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'}`}>
          {items.map((it, i) => (
            <button key={i} role="menuitem" type="button" onClick={() => { setOpen(false); it.onClick() }}
              className={`relative w-full flex items-center gap-3 px-3 py-2.5 text-left before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.08] ${it.danger ? 'text-error' : 'text-on-surface'} ${it.selected ? 'bg-secondary-container' : ''}`}>
              {it.icon && <Icon name={it.icon} size={22} className={it.danger ? '' : 'text-on-surface-variant'} />}
              <span className="flex-1 min-w-0">
                <span className="block type-body-lg truncate">{it.label}</span>
                {it.supporting && <span className="block type-body-sm text-on-surface-variant">{it.supporting}</span>}
              </span>
              {it.selected && <Icon name="check" size={20} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Snackbar ─────────────────────────────────────────────────────────────── */
interface Snack { id: number; message: string; action?: { label: string; onClick: () => void } }
const SnackCtx = createContext<(message: string, action?: Snack['action']) => void>(() => {})
export const useSnackbar = () => useContext(SnackCtx)

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<Snack | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((message: string, action?: Snack['action']) => {
    if (timer.current) clearTimeout(timer.current)
    setSnack({ id: Date.now(), message, action })
    timer.current = setTimeout(() => setSnack(null), action ? 6000 : 4000)
  }, [])
  return (
    <SnackCtx.Provider value={show}>
      {children}
      {snack && (
        <Portal>
          <div role="status" key={snack.id}
            className="fixed z-[70] left-4 right-4 lg:left-auto lg:right-6 bottom-[calc(88px+env(safe-area-inset-bottom))] lg:bottom-6 mx-auto lg:mx-0 max-w-md md-enter-up
              flex items-center gap-2 min-h-12 pl-4 pr-2 py-2 rounded-[4px] bg-inverse-surface text-inverse-on-surface shadow-elev-3">
            <span className="flex-1 type-body">{snack.message}</span>
            {snack.action && (
              <button type="button" onClick={() => { snack.action!.onClick(); setSnack(null) }}
                className="px-3 h-9 rounded-full type-label-lg text-inverse-primary hover:bg-white/10">{snack.action.label}</button>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => setSnack(null)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10">
              <Icon name="close" size={18} />
            </button>
          </div>
        </Portal>
      )}
    </SnackCtx.Provider>
  )
}
