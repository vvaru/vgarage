'use client'

import { useVehicle } from '@/components/vehicle/VehicleContext'
import { useSnackbar } from '@/components/ui/md'
import CarForm from '@/components/forms/CarForm'

/** First run: no car yet, or one whose details were never confirmed. */
export default function VehicleSetupModal() {
  const { vehicle } = useVehicle()
  const snack = useSnackbar()
  return <CarForm setup car={vehicle} onClose={() => {}} onSaved={snack} />
}
