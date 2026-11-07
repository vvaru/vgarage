'use client'

import { useAuth } from '@/components/auth/AuthProvider'
import PageHeader, { Page } from '@/components/shell/PageHeader'
import { Avatar, Card, Icon, ListItem, type IconName } from '@/components/ui/md'

// Everything set up once lives here, with names instead of bare icons.
const ROWS: { href: string; icon: IconName; headline: string; supporting: string; admin?: boolean }[] = [
  { href: '/garage', icon: 'directions_car', headline: 'Cars', supporting: 'Your cars, odometer, tire tracking' },
  { href: '/categories', icon: 'category', headline: 'Service categories', supporting: 'What you track and how often' },
  { href: '/import', icon: 'import_export', headline: 'Import & export', supporting: 'Carfax import, PDF history' },
  { href: '/admin', icon: 'admin_panel_settings', headline: 'Admin', supporting: 'Users and the category catalog', admin: true },
]

export default function MorePage() {
  const { isAdmin } = useAuth()
  return (
    <Page>
      <PageHeader title="More" />
      <Card variant="filled" className="max-w-2xl overflow-hidden py-2">
        {ROWS.filter(r => !r.admin || isAdmin).map(r => (
          <ListItem key={r.href} href={r.href} leading={<Avatar icon={r.icon} tone="secondary" />}
            headline={r.headline} supporting={r.supporting} trailing={<Icon name="chevron_right" size={24} />} />
        ))}
      </Card>
    </Page>
  )
}
