export interface Vehicle {
  id: string
  user_id: string
  make: string
  model: string
  year: number
  trim: string | null
  odometer: number
  vin: string | null
  license_plate: string | null
  details_confirmed?: boolean
  created_at: string
}

export interface ServiceCategory {
  id: string
  user_id: string
  vehicle_id: string
  name: string
  category_type: 'maintenance' | 'repair'
  sub_type: 'service' | 'check' | null
  interval_miles: number | null
  interval_days: number | null
  global_category_id?: string | null
  is_visible?: boolean
  created_at: string
}

export interface UserProfile {
  id: string
  email: string | null
  full_name: string | null
  role: 'admin' | 'user'
  created_at: string
}

export interface GlobalCategory {
  id: string
  name: string
  category_type: 'maintenance' | 'repair'
  interval_miles: number | null
  interval_days: number | null
  is_active: boolean
  created_by: string | null
  created_at: string
}

export interface CategoryRequest {
  id: string
  user_id: string
  vehicle_id: string | null
  name: string
  description: string | null
  interval_miles: number | null
  interval_days: number | null
  status: 'pending' | 'approved' | 'rejected'
  admin_notes: string | null
  created_at: string
}

export interface ServiceCategoryProduct {
  id: string
  user_id: string
  category_id: string
  vehicle_id: string
  name: string
  product_url: string | null
  last_price: number | null
  created_at: string
}

export interface ServiceLog {
  id: string
  user_id: string
  vehicle_id: string
  service_type: string
  category_id: string | null
  record_type: string | null       // 'maintenance' | 'repair'
  performed_by: string             // 'owner' | 'shop'
  shop_name: string | null
  shop_location: string | null
  receipt_url: string | null
  session_id: string | null
  date: string
  odometer: number
  cost: number | null
  notes: string | null
  created_at: string
}

export interface FuelLog {
  id: string
  user_id: string
  vehicle_id: string
  date: string
  odometer: number
  gallons: number | null
  price_per_gallon: number | null
  total_cost: number | null
  mpg: number | null
  created_at: string
}

export interface Product {
  id: string
  user_id: string
  vehicle_id: string | null
  name: string
  brand: string | null
  notes: string | null
  created_at: string
}

export interface ProductLink {
  id: string
  product_id: string
  label: string
  url: string
}

export interface ProductCategoryLink {
  product_id: string
  category_id: string
}

export interface ServiceReminder {
  id: string
  user_id: string
  vehicle_id: string
  service_type: string
  last_done_odometer: number | null
  interval_miles: number | null
  interval_days: number | null
  next_due_odometer: number | null
  next_due_date: string | null
  created_at: string
}

export const SERVICE_TYPES = [
  'Oil Change',
  'CVT Fluid',
  'Spark Plugs',
  'Tire Rotation',
  'Brake Inspection',
  'Air Filter',
  'Cabin Filter',
  'Coolant',
  'Wiper Blades',
  'Detailing',
  'Custom',
] as const

export type ServiceType = (typeof SERVICE_TYPES)[number]

export const DEFAULT_MAINTENANCE_CATEGORIES = [
  { name: 'Oil Change',        interval_miles: 5000,  interval_days: 180  },
  { name: 'CVT Fluid',         interval_miles: 30000, interval_days: 1095 },
  { name: 'Spark Plugs',       interval_miles: 60000, interval_days: 2190 },
  { name: 'Tire Rotation',     interval_miles: 5000,  interval_days: 180  },
  { name: 'Brake Inspection',  interval_miles: 20000, interval_days: 730  },
  { name: 'Air Filter',        interval_miles: 20000, interval_days: 730  },
  { name: 'Cabin Filter',      interval_miles: 15000, interval_days: 540  },
]
