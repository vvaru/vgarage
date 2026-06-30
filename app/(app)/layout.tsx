'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useAuth } from '@/components/auth/AuthProvider'
import { VehicleProvider, useVehicle } from '@/components/vehicle/VehicleContext'
import BottomNav from '@/components/ui/BottomNav'
import VehicleSetupModal from '@/components/ui/VehicleSetupModal'
import { BUILD_ID } from '@/lib/build'

function TroubleScreen({ title, detail, lines, onRetry }: {
  title: string
  detail?: string | null
  lines: string[]
  onRetry: () => void
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="bg-surface border border-border rounded-3xl p-6 w-full max-w-sm text-center">
        <div className="w-12 h-12 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={22} className="text-danger" />
        </div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {detail && <p className="text-muted text-sm mt-1.5 break-words">{detail}</p>}
        <div className="mt-4 bg-surface-2 rounded-xl px-3 py-2.5 text-left">
          {lines.map((l, i) => <p key={i} className="text-faint text-xs font-mono">{l}</p>)}
          <p className="text-faint text-xs font-mono">{BUILD_ID}</p>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={() => window.location.reload()} className="flex-1 bg-surface-2 hover:bg-border text-foreground font-medium rounded-2xl py-2.5 transition-colors">Reload</button>
          <button onClick={onRetry} className="flex-1 bg-accent hover:bg-accent-hover text-accent-foreground font-bold rounded-2xl py-2.5 transition-colors">Retry</button>
        </div>
      </div>
    </div>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const { vehicle, loading: vehicleLoading, error: vehicleError, refresh } = useVehicle()

  useEffect(() => {
    console.log('[vGarage]', BUILD_ID)
  }, [])

  useEffect(() => {
    if (!loading && !session) window.location.replace('/login')
  }, [session, loading])

  // Determine what's blocking the whole page (if anything).
  const blocking: 'auth' | 'redirect' | 'error' | 'vehicle' | null =
    loading ? 'auth'
    : !session ? 'redirect'
    : vehicleError && !vehicle ? 'error'
    : vehicleLoading && !vehicle ? 'vehicle'
    : null

  // Watchdog: if a spinner state lasts too long, surface a diagnostic + a way out.
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    setStuck(false)
    if (blocking === 'auth' || blocking === 'vehicle') {
      const t = setTimeout(() => setStuck(true), 14000)
      return () => clearTimeout(t)
    }
  }, [blocking])

  if (blocking === 'error' || ((blocking === 'auth' || blocking === 'vehicle') && stuck)) {
    return (
      <TroubleScreen
        title="Can’t reach the server"
        detail={vehicleError ?? 'It’s taking longer than expected.'}
        lines={[
          `stage: ${blocking}`,
          `auth: ${loading ? 'loading' : 'ready'} · session: ${session ? 'yes' : 'no'}`,
          `vehicles: ${vehicleLoading ? 'loading' : vehicleError ? 'error' : vehicle ? 'ok' : 'none'}`,
        ]}
        onRetry={() => refresh()}
      />
    )
  }

  if (blocking) {
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
