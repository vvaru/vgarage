-- vGarage v2 schema additions
-- Run in Supabase SQL Editor AFTER schema.sql

-- service_categories: replaces service_reminders for upcoming-services logic
create table if not exists service_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  vehicle_id uuid references vehicles(id) on delete cascade not null,
  name text not null,
  category_type text not null default 'maintenance', -- 'maintenance' | 'repair'
  interval_miles integer,
  interval_days integer,
  created_at timestamptz default now() not null
);
alter table service_categories enable row level security;
create policy "Users own service categories" on service_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- service_category_products: products/parts linked to a category for a vehicle
create table if not exists service_category_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  category_id uuid references service_categories(id) on delete cascade not null,
  vehicle_id uuid references vehicles(id) on delete cascade not null,
  name text not null,
  product_url text,
  last_price numeric(10,2),
  created_at timestamptz default now() not null
);
alter table service_category_products enable row level security;
create policy "Users own category products" on service_category_products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Add new columns to service_logs
alter table service_logs add column if not exists category_id uuid references service_categories(id) on delete set null;
alter table service_logs add column if not exists record_type text default 'maintenance'; -- 'maintenance' | 'repair'
alter table service_logs add column if not exists performed_by text default 'owner';      -- 'owner' | 'shop'
alter table service_logs add column if not exists shop_name text;
alter table service_logs add column if not exists shop_location text;
alter table service_logs add column if not exists receipt_url text;

-- Storage bucket for receipts (run separately if storage policies fail)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipts', 'receipts', false, 10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do nothing;

create policy "receipts_insert" on storage.objects for insert
  with check (auth.uid()::text = (storage.foldername(name))[1] and bucket_id = 'receipts');
create policy "receipts_select" on storage.objects for select
  using (auth.uid()::text = (storage.foldername(name))[1] and bucket_id = 'receipts');
create policy "receipts_delete" on storage.objects for delete
  using (auth.uid()::text = (storage.foldername(name))[1] and bucket_id = 'receipts');
