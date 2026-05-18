'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
import { VehicleProvider, useVehicle } from '@/components/vehicle/VehicleContext'
import BottomNav from '@/components/ui/BottomNav'
import VehicleSetupModal from '@/components/ui/VehicleSetupModal'

function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const { vehicle, loading: vehicleLoading } = useVehicle()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !session) {
      router.replace('/login')
    }
  }, [session, loading, router])

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <div style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
        {children}
      </div>
      <BottomNav />
      {!vehicleLoading && vehicle === null && <VehicleSetupModal />}
    </div>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      <AppShell>{children}</AppShell>
    </VehicleProvider>
  )
}
