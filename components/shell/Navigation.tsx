'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import Icon, { type IconName } from '@/components/ui/Icon'
import { useForms } from './forms'

export const DESTINATIONS: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: '/dashboard', label: 'Home', icon: 'home', match: ['/dashboard'] },
  { href: '/service', label: 'Services', icon: 'build', match: ['/service'] },
  { href: '/fuel', label: 'Fuel', icon: 'local_gas_station', match: ['/fuel'] },
  { href: '/products', label: 'Stock', icon: 'inventory_2', match: ['/products'] },
  { href: '/more', label: 'More', icon: 'more_horiz', match: ['/more', '/garage', '/admin', '/categories'] },
]

const isActive = (path: string, match: string[]) => match.some(m => path === m || path.startsWith(m + '/'))

const ADD_ITEMS: { icon: IconName; label: string; supporting: string; req: Parameters<ReturnType<typeof useForms>['open']>[0] }[] = [
  { icon: 'local_gas_station', label: 'Log fuel', supporting: 'A fill-up', req: { kind: 'fuel' } },
  { icon: 'build', label: 'Log service', supporting: 'Shop or DIY work on the car', req: { kind: 'service' } },
  { icon: 'receipt_long', label: 'Add product receipt', supporting: 'Parts you bought go into stock', req: { kind: 'receipt' } },
  { icon: 'add_box', label: 'Add stock', supporting: 'Parts you already have, no receipt', req: { kind: 'stock', mode: 'add' } },
]

/** The "+ Add" button and its menu of the four ways data gets in. */
export function AddButton({ variant }: { variant: 'rail' | 'fab' }) {
  const { open } = useForms()
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); window.removeEventListener('keydown', onKey) }
  }, [menu])

  const panel = menu && (
    <div role="menu" className={`absolute z-50 w-72 py-2 rounded-2xl bg-surface-container-high shadow-elev-3 md-scale ${variant === 'rail'
      ? 'left-full top-0 ml-3 origin-top-left' : 'right-0 bottom-full mb-3 origin-bottom-right'}`}>
      {ADD_ITEMS.map(it => (
        <button key={it.label} role="menuitem" type="button" onClick={() => { setMenu(false); open(it.req) }}
          className="relative w-full flex items-center gap-4 px-4 py-3 text-left before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.08]">
          <span className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center shrink-0"><Icon name={it.icon} size={20} /></span>
          <span className="min-w-0">
            <span className="block type-body-lg text-on-surface">{it.label}</span>
            <span className="block type-body-sm text-on-surface-variant">{it.supporting}</span>
          </span>
        </button>
      ))}
    </div>
  )

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}
        className={`relative overflow-hidden flex items-center justify-center bg-primary-container text-on-primary-container shadow-elev-3 hover:shadow-elev-3
          before:absolute before:inset-0 before:bg-current before:opacity-0 hover:before:opacity-[0.08] active:before:opacity-[0.12] ${variant === 'rail'
          ? 'w-14 h-14 rounded-2xl' : 'h-14 pl-4 pr-5 gap-3 rounded-2xl type-label-lg'}`}>
        <Icon name={menu ? 'close' : 'add'} size={24} />
        {variant === 'fab' && <span className="relative text-base">Add</span>}
      </button>
      {panel}
    </div>
  )
}

export function NavRail({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname()
  return (
    <nav aria-label="Main" className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-[88px] flex-col items-center gap-1 pt-6 pb-4 bg-surface">
      <div className="mb-6"><AddButton variant="rail" /></div>
      {DESTINATIONS.map(d => {
        const on = isActive(path, d.match)
        return (
          <Link key={d.href} href={d.href} aria-current={on ? 'page' : undefined}
            className={`group flex flex-col items-center gap-1 w-full py-1.5 type-label ${on ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <span className={`relative w-14 h-8 rounded-full flex items-center justify-center overflow-hidden transition-colors ${on ? 'bg-secondary-container text-on-secondary-container' : 'group-hover:bg-surface-container-highest'}`}>
              <Icon name={d.icon} size={24} fill={on} />
            </span>
            {d.label}
          </Link>
        )
      })}
      {isAdmin && (
        <Link href="/admin" className={`mt-auto flex flex-col items-center gap-1 w-full py-1.5 type-label ${isActive(path, ['/admin']) ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface'}`} title="Admin">
          <span className="w-14 h-8 rounded-full flex items-center justify-center hover:bg-surface-container-highest"><Icon name="admin_panel_settings" size={22} /></span>
          Admin
        </Link>
      )}
    </nav>
  )
}

export function NavBar() {
  const path = usePathname()
  return (
    <>
      <div className="lg:hidden fixed right-4 z-40 bottom-[calc(96px+env(safe-area-inset-bottom))]"><AddButton variant="fab" /></div>
      <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-container" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5 h-20 max-w-xl mx-auto">
          {DESTINATIONS.map(d => {
            const on = isActive(path, d.match)
            return (
              <Link key={d.href} href={d.href} aria-current={on ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-1 type-label ${on ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                <span className={`w-16 h-8 rounded-full flex items-center justify-center transition-colors ${on ? 'bg-secondary-container text-on-secondary-container' : ''}`}>
                  <Icon name={d.icon} size={24} fill={on} />
                </span>
                {d.label}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
