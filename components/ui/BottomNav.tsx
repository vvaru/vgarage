'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Wrench, Fuel, Car, Package, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'

const USER_TABS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/service',   label: 'Service',   icon: Wrench },
  { href: '/fuel',      label: 'Fuel',      icon: Fuel },
  { href: '/products',  label: 'Products',  icon: Package },
  { href: '/garage',    label: 'Garage',    icon: Car },
]

export default function BottomNav() {
  const pathname = usePathname()
  const { isAdmin } = useAuth()
  const tabs = isAdmin
    ? [...USER_TABS, { href: '/admin', label: 'Admin', icon: ShieldCheck }]
    : USER_TABS
  const iconSize = isAdmin ? 20 : 22
  const labelClass = isAdmin ? 'text-[10px] font-medium' : 'text-xs font-medium'

  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-zinc-900/95 backdrop-blur-md border-t border-zinc-800/60 z-40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-around h-16 max-w-2xl mx-auto">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 flex-1 py-2 transition-colors ${
                active ? 'text-blue-500' : 'text-zinc-500'
              }`}
            >
              <Icon size={iconSize} strokeWidth={active ? 2.5 : 1.5} />
              <span className={labelClass}>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
