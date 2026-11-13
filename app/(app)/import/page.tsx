'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useVehicle } from '@/components/vehicle/VehicleContext'
import PageHeader, { Page } from '@/components/shell/PageHeader'
import { useCarData } from '@/lib/useCarData'
import { Avatar, Card, Icon, ListItem } from '@/components/ui/md'

const ExportPdfModal = dynamic(() => import('@/components/service/ExportPdfModal'), { ssr: false })
const CarfaxImportModal = dynamic(() => import('@/components/service/CarfaxImportModal'), { ssr: false })

export default function ImportExportPage() {
  const { vehicle } = useVehicle()
  const { categories, services, reload } = useCarData(vehicle?.id)
  const [modal, setModal] = useState<'export' | 'carfax' | null>(null)
  if (!vehicle) return null
  return (
    <Page>
      <PageHeader title="Import & export" />
      <Card variant="outlined" className="max-w-2xl overflow-hidden py-1">
        <ListItem onClick={() => setModal('carfax')} leading={<Avatar icon="upload_file" tone="secondary" />}
          headline="Import from Carfax" supporting="Paste a report, review it, import past services" trailing={<Icon name="chevron_right" size={24} />} />
        <ListItem onClick={() => setModal('export')} leading={<Avatar icon="picture_as_pdf" tone="secondary" />}
          headline="Export service history (PDF)" supporting={`${services.length} services, with receipts. Handy when selling the car`} trailing={<Icon name="chevron_right" size={24} />} />
      </Card>
      {modal === 'export' && <ExportPdfModal vehicle={vehicle} logs={services} categories={categories} onClose={() => setModal(null)} />}
      {modal === 'carfax' && <CarfaxImportModal vehicle={vehicle} categories={categories} onClose={() => setModal(null)} onImported={reload} />}
    </Page>
  )
}
