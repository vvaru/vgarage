'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Wrench, Fuel } from 'lucide-react'

const tabs = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/service', label: 'Service', icon: Wrench },
  { href: '/fuel', label: 'Fuel', icon: Fuel },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-zinc-900/95 backdrop-blur-md border-t border-zinc-800/60 z-40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 flex-1 py-2 transition-colors ${
                active ? 'text-amber-500' : 'text-zinc-500'
              }`}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 1.5} />
              <span className="text-xs font-medium">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
