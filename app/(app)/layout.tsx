'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import { VehicleProvider, useVehicle } from '@/components/vehicle/VehicleContext'
import VehicleSetupModal from '@/components/ui/VehicleSetupModal'
import { NavRail, NavBar } from '@/components/shell/Navigation'
import { FormsProvider } from '@/components/shell/forms'
import FormHost from '@/components/forms/FormHost'
import { Button, SnackbarProvider } from '@/components/ui/md'
import Icon from '@/components/ui/Icon'
import { BUILD_ID } from '@/lib/build'

function TroubleScreen({ title, detail, lines, onRetry }: {
  title: string
  detail?: string | null
  lines: string[]
  onRetry: () => void
}) {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="bg-surface-container-high rounded-[28px] p-6 w-full max-w-sm">
        <span className="w-12 h-12 rounded-full bg-error-container text-on-error-container flex items-center justify-center mb-4">
          <Icon name="cloud_off" size={24} />
        </span>
        <h2 className="type-headline-sm text-on-surface">{title}</h2>
        {detail && <p className="type-body text-on-surface-variant mt-2 break-words">{detail}</p>}
        <div className="mt-4 bg-surface-container-highest rounded-xl px-3 py-2.5">
          {lines.map((l, i) => <p key={i} className="text-on-surface-variant text-xs font-mono">{l}</p>)}
          <p className="text-on-surface-variant text-xs font-mono">{BUILD_ID}</p>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="text" onClick={() => window.location.reload()}>Reload</Button>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-4" aria-busy="true">
      <span className="w-12 h-12 rounded-2xl bg-primary-container text-on-primary-container flex items-center justify-center">
        <Icon name="directions_car" size={28} />
      </span>
      <span className="w-40 h-1 rounded-full bg-surface-container-highest overflow-hidden">
        <span className="block h-full w-1/3 rounded-full bg-primary animate-[md-shimmer_1.2s_ease-in-out_infinite] md-skeleton" />
      </span>
    </div>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  const { session, loading, isAdmin } = useAuth()
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

  if (blocking) return <Loading />

  return (
    <SnackbarProvider>
      <FormsProvider>
        <div className="min-h-screen bg-surface">
          <NavRail isAdmin={isAdmin} />
          <main className="lg:pl-[88px]">{children}</main>
          <NavBar />
          <FormHost />
          {!vehicleLoading && !vehicleError && (vehicle === null || vehicle?.details_confirmed === false) && <VehicleSetupModal />}
        </div>
      </FormsProvider>
    </SnackbarProvider>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      <AppShell>{children}</AppShell>
    </VehicleProvider>
  )
}
