'use client'

import type { ReactNode } from 'react'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { Menu } from '@/components/ui/md'
import Icon from '@/components/ui/Icon'

/** Which car the page is about; a menu when there's more than one. */
export function VehicleSwitcher() {
  const { vehicle, vehicles, setActiveVehicleId } = useVehicle()
  if (!vehicle) return null
  const name = `${vehicle.year} ${vehicle.make} ${vehicle.model}`
  if (vehicles.length < 2) {
    return (
      <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-outline-variant type-label-lg text-on-surface-variant whitespace-nowrap">
        <Icon name="directions_car" size={18} />{name}
      </span>
    )
  }
  return (
    <Menu
      trigger={({ toggle, open }) => (
        <button type="button" onClick={toggle} aria-expanded={open}
          className="relative inline-flex items-center gap-1.5 h-8 pl-3 pr-1.5 rounded-lg border border-outline-variant type-label-lg text-on-surface-variant whitespace-nowrap hover:bg-surface-container-highest">
          <Icon name="directions_car" size={18} />{name}<Icon name="arrow_drop_down" size={20} />
        </button>
      )}
      items={vehicles.map(v => ({ label: `${v.year} ${v.make} ${v.model}`, supporting: `${v.odometer.toLocaleString()} mi`, icon: 'directions_car' as const, selected: v.id === vehicle.id, onClick: () => setActiveVehicleId(v.id) }))}
    />
  )
}

/** Page title row: large on desktop, compact on phones. */
export default function PageHeader({ title, subtitle, actions, showVehicle = true, eyebrow }: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  showVehicle?: boolean
  eyebrow?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-[max(16px,env(safe-area-inset-top))] lg:pt-8 pb-4 lg:pb-6">
      <div className="flex-1 min-w-0">
        {eyebrow && <div className="type-label-lg text-on-surface-variant mb-0.5">{eyebrow}</div>}
        <h1 className="type-headline-sm lg:type-headline-lg text-on-surface truncate">{title}</h1>
        {subtitle && <p className="type-body text-on-surface-variant mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {showVehicle && <span className="max-sm:hidden mr-2"><VehicleSwitcher /></span>}
        {actions}
      </div>
    </header>
  )
}

/** Standard page width and gutters. */
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-10 pb-36 lg:pb-16 ${className}`}>{children}</div>
}
