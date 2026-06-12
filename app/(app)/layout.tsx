'use client'

import { useEffect } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { VehicleProvider, useVehicle } from '@/components/vehicle/VehicleContext'
import BottomNav from '@/components/ui/BottomNav'
import VehicleSetupModal from '@/components/ui/VehicleSetupModal'

function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const { vehicle, loading: vehicleLoading } = useVehicle()

  useEffect(() => {
    if (!loading && !session) {
      window.location.replace('/login')
    }
  }, [session, loading])

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
        {children}
      </div>
      <BottomNav />
      {!vehicleLoading && (vehicle === null || vehicle?.details_confirmed === false) && <VehicleSetupModal />}
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
