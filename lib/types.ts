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
  created_at: string
}

export interface ServiceCategory {
  id: string
  user_id: string
  vehicle_id: string
  name: string
  category_type: 'maintenance' | 'repair'
  interval_miles: number | null
  interval_days: number | null
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
  gallons: number
  price_per_gallon: number
  total_cost: number
  mpg: number | null
  created_at: string
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
