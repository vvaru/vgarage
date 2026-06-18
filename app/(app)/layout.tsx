'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { VehicleProvider, useVehicle } from '@/components/vehicle/VehicleContext'
import BottomNav from '@/components/ui/BottomNav'
import VehicleSetupModal from '@/components/ui/VehicleSetupModal'

function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const { vehicle, loading: vehicleLoading, error: vehicleError, refresh } = useVehicle()

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

  // Couldn't reach the server and there's nothing to show — surface the actual
  // error with a way out, instead of hanging on an endless spinner.
  if (vehicleError && !vehicle && !vehicleLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={22} className="text-danger" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Can’t reach the server</h2>
          <p className="text-muted text-sm mt-1.5 break-words">{vehicleError}</p>
          <div className="flex gap-3 mt-5">
            <button onClick={() => window.location.reload()} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-2.5 transition-colors">Reload</button>
            <button onClick={() => refresh()} className="flex-1 bg-accent hover:bg-accent-hover text-accent-foreground font-bold rounded-2xl py-2.5 transition-colors">Retry</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
        {children}
      </div>
      <BottomNav />
      {!vehicleLoading && !vehicleError && (vehicle === null || vehicle?.details_confirmed === false) && <VehicleSetupModal />}
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
