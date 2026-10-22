// Drop-in replacements for the lucide-react icons the app used, drawn with
// Material Symbols so every screen shares one icon style. Same names and the
// props that were used (size, className, strokeWidth → weight).
import Icon, { type IconName } from './Icon'

interface P { size?: number; className?: string; strokeWidth?: number; fill?: string }

function make(name: IconName) {
  function C({ size = 24, className = '', strokeWidth }: P) {
    const weight = strokeWidth == null ? 400 : strokeWidth >= 2.4 ? 600 : strokeWidth >= 2 ? 500 : strokeWidth <= 1.5 ? 300 : 400
    return <Icon name={name} size={size} weight={weight} className={className} />
  }
  C.displayName = `Icon(${name})`
  return C
}

export const AlertCircle = make('error')
export const AlertTriangle = make('warning')
export const Archive = make('archive')
export const ArrowRight = make('arrow_forward')
export const Ban = make('block')
export const CalendarClock = make('event_upcoming')
export const Car = make('directions_car')
export const Check = make('check')
export const CheckCircle2 = make('check_circle')
export const ChevronDown = make('expand_more')
export const ChevronLeft = make('chevron_left')
export const ChevronRight = make('chevron_right')
export const CircleAlert = make('error')
export const CircleGauge = make('speed')
export const Clock = make('schedule')
export const Copy = make('content_copy')
export const Download = make('download')
export const ExternalLink = make('open_in_new')
export const FileText = make('description')
export const Fuel = make('local_gas_station')
export const Gauge = make('speed')
export const Image = make('image')
export const ImageOff = make('hide_image')
export const Info = make('info')
export const LayoutDashboard = make('dashboard')
export const Leaf = make('eco')
export const Link = make('link')
export const Link2 = make('link')
export const Loader2 = make('progress_activity')
export const LogOut = make('logout')
export const Minus = make('remove')
export const Package = make('inventory_2')
export const Paperclip = make('attach_file')
export const Pencil = make('edit')
export const Plus = make('add')
export const Receipt = make('receipt_long')
export const RefreshCw = make('refresh')
export const RotateCw = make('rotate_right')
export const Search = make('search')
export const Settings = make('settings')
export const ShieldCheck = make('admin_panel_settings')
export const SlidersHorizontal = make('tune')
export const Split = make('call_split')
export const Tag = make('sell')
export const Trash2 = make('delete')
export const TrendingUp = make('trending_up')
export const Upload = make('upload')
export const Users = make('group')
export const Wrench = make('build')
export const X = make('close')
