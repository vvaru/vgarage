import type { CSSProperties } from 'react'

// Material Symbols Rounded, subset to exactly these names (app/layout.tsx builds
// the font request from this list). An icon missing here would render as its
// name in plain text, so the type below only accepts listed names.
export const ICON_NAMES = [
  'add', 'add_a_photo', 'add_box', 'admin_panel_settings', 'air', 'archive', 'arrow_back', 'arrow_downward',
  'arrow_drop_down', 'arrow_forward', 'arrow_upward', 'attach_file', 'bar_chart', 'block', 'build', 'calendar_month',
  'call_split', 'car_crash', 'car_repair', 'category', 'check', 'check_circle', 'chevron_left', 'chevron_right',
  'close', 'cloud_off', 'construction', 'content_copy', 'dark_mode', 'dashboard', 'delete', 'description', 'directions_car',
  'distance', 'download', 'eco', 'edit', 'error', 'event', 'event_upcoming', 'expand_less', 'expand_more',
  'filter_list', 'garage', 'group', 'handyman', 'hide_image', 'history', 'home', 'image', 'import_export',
  'info', 'insights', 'inventory_2', 'lightbulb', 'link', 'local_gas_station', 'lock', 'logout', 'menu',
  'more_horiz', 'more_vert', 'new_releases', 'oil_barrel', 'open_in_new', 'payments', 'person',
  'picture_as_pdf', 'progress_activity', 'receipt_long', 'refresh', 'remove', 'request_quote', 'rotate_right',
  'route', 'savings', 'schedule', 'search', 'sell', 'settings', 'shopping_cart', 'sort', 'speed',
  'storefront', 'sync', 'tire_repair', 'trending_down', 'trending_flat', 'trending_up', 'tune', 'upload',
  'upload_file', 'warning', 'water_drop',
] as const

export type IconName = (typeof ICON_NAMES)[number]

export const ICON_FONT_URL =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,0'
  + `&icon_names=${[...ICON_NAMES].sort().join(',')}&display=block`

interface Props {
  name: IconName
  size?: number
  /** Filled variant (used for the active nav item and status marks). */
  fill?: boolean
  weight?: 300 | 400 | 500 | 600
  className?: string
  style?: CSSProperties
  title?: string
}

export default function Icon({ name, size = 24, fill = false, weight = 400, className = '', style, title }: Props) {
  return (
    <span
      className={`material-symbols-rounded ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      style={{
        fontSize: size, width: size, height: size,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${Math.min(48, Math.max(20, size))}`,
        ...style,
      }}
    >
      {name}
    </span>
  )
}
