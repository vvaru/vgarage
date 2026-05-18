-- Run this in your Supabase SQL editor
-- Do NOT modify existing tables: daily_logs, profiles, recipes

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  make text not null,
  model text not null,
  year integer not null,
  trim text,
  odometer integer not null default 0,
  vin text,
  license_plate text,
  created_at timestamptz default now() not null
);

alter table vehicles enable row level security;

create policy "Users own vehicles" on vehicles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists service_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  vehicle_id uuid references vehicles(id) on delete cascade not null,
  service_type text not null,
  date date not null,
  odometer integer not null,
  cost numeric(10,2),
  notes text,
  created_at timestamptz default now() not null
);

alter table service_logs enable row level security;

create policy "Users own service logs" on service_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists fuel_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  vehicle_id uuid references vehicles(id) on delete cascade not null,
  date date not null,
  odometer integer not null,
  gallons numeric(8,3) not null,
  price_per_gallon numeric(6,3) not null,
  total_cost numeric(10,2) not null,
  mpg numeric(6,2),
  created_at timestamptz default now() not null
);

alter table fuel_logs enable row level security;

create policy "Users own fuel logs" on fuel_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists service_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  vehicle_id uuid references vehicles(id) on delete cascade not null,
  service_type text not null,
  last_done_odometer integer,
  interval_miles integer,
  interval_days integer,
  next_due_odometer integer,
  next_due_date date,
  created_at timestamptz default now() not null
);

alter table service_reminders enable row level security;

create policy "Users own service reminders" on service_reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
