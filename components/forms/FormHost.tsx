'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { read } from '@/lib/recover'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import { useForms } from '@/components/shell/forms'
import { useSnackbar } from '@/components/ui/md'
import FuelLogModal from '@/components/fuel/FuelLogModal'
import ServiceForm from './ServiceForm'
import ReceiptForm from './ReceiptForm'
import StockForm from './StockForm'
import ProductForm from './ProductForm'
import type { FuelLog } from '@/lib/types'

// Renders whichever data-entry form is open. Each form loads what it needs, saves,
// then calls done(): the form closes, pages reload, and a snackbar confirms.
export default function FormHost() {
  const { active, close, changed } = useForms()
  const { vehicle, refresh } = useVehicle()
  const snack = useSnackbar()
  // Editing a fill-up loads it first; a new one starts empty.
  const [loaded, setLoaded] = useState<{ id: string; log: FuelLog | null } | null>(null)
  const fuelId = active?.kind === 'fuel' ? active.logId : undefined
  useEffect(() => {
    if (!fuelId) return
    let live = true
    read(supabase.from('fuel_logs').select('*').eq('id', fuelId).single())
      .then(({ data }) => { if (live) setLoaded({ id: fuelId, log: (data as FuelLog) ?? null }) })
      .catch(() => { if (live) setLoaded({ id: fuelId, log: null }) })
    return () => { live = false }
  }, [fuelId])
  const fuelLog = !fuelId ? null : loaded?.id === fuelId ? loaded.log : undefined

  if (!active || !vehicle) return null

  const done = (message: string) => {
    close()
    changed()
    refresh()
    snack(message)
  }

  if (active.kind === 'fuel') {
    if (fuelLog === undefined) return null
    return <FuelLogModal key={fuelId ?? 'new'} vehicle={vehicle} log={fuelLog} onClose={close} onSaved={() => done(fuelLog ? 'Fill-up updated' : 'Fill-up saved')} />
  }
  if (active.kind === 'service') {
    return <ServiceForm key={active.logId ?? 'new'} logId={active.logId} productId={active.productId} categoryId={active.categoryId} onClose={close} onSaved={done} />
  }
  if (active.kind === 'receipt') return <ReceiptForm key={active.receiptId ?? 'new'} receiptId={active.receiptId} onClose={close} onSaved={done} />
  if (active.kind === 'product') return <ProductForm key={active.productId ?? 'new'} productId={active.productId} onClose={close} onSaved={done} />
  if (active.kind === 'stock') return <StockForm mode={active.mode} productId={active.productId} onClose={close} onSaved={done} />
  return null
}
