-- =============================================================
-- Admin system migration
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================

-- 1. User profiles table  (must exist BEFORE get_my_role() function)
CREATE TABLE IF NOT EXISTS user_profiles (
  id          UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT,
  full_name   TEXT,
  role        TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Security-definer helper — gets the calling user's role.
--    SECURITY DEFINER bypasses RLS so this can be called inside policies
--    without causing infinite recursion on user_profiles itself.
--    Table must exist first (created above).
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(role, 'user') FROM user_profiles WHERE id = auth.uid();
$$;

-- 3. RLS on user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON user_profiles
  FOR SELECT USING (auth.uid() = id OR get_my_role() = 'admin');

CREATE POLICY "profiles_insert" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_self" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "profiles_update_admin" ON user_profiles
  FOR UPDATE USING (get_my_role() = 'admin');

-- 4. Add details_confirmed to vehicles so we can prompt existing
--    placeholder accounts to enter their real car info
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS details_confirmed BOOLEAN DEFAULT FALSE;

-- 5. Admin read access to all existing tables
CREATE POLICY "admin_read_all_vehicles" ON vehicles
  FOR SELECT USING (get_my_role() = 'admin');

CREATE POLICY "admin_read_all_service_categories" ON service_categories
  FOR SELECT USING (get_my_role() = 'admin');

CREATE POLICY "admin_insert_any_service_category" ON service_categories
  FOR INSERT WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "admin_update_any_service_category" ON service_categories
  FOR UPDATE USING (get_my_role() = 'admin');

CREATE POLICY "admin_read_all_service_logs" ON service_logs
  FOR SELECT USING (get_my_role() = 'admin');

-- 6. Per-user category visibility flag
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;

-- 7. Track which global template a user category was seeded from
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS global_category_id UUID;

-- 8. Global category templates (admin-managed master list)
CREATE TABLE IF NOT EXISTS global_categories (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT    NOT NULL,
  category_type   TEXT    NOT NULL DEFAULT 'maintenance' CHECK (category_type IN ('maintenance', 'repair')),
  interval_miles  INTEGER,
  interval_days   INTEGER,
  is_active       BOOLEAN DEFAULT TRUE,
  created_by      UUID    REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE global_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_global_categories" ON global_categories
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "admin_manage_global_categories" ON global_categories
  FOR ALL USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');

-- Seed global categories (only if table is empty)
INSERT INTO global_categories (name, category_type, interval_miles, interval_days)
SELECT * FROM (VALUES
  ('Oil Change',       'maintenance', 5000,  180),
  ('CVT Fluid',        'maintenance', 30000, 1095),
  ('Spark Plugs',      'maintenance', 60000, 2190),
  ('Tire Rotation',    'maintenance', 5000,  180),
  ('Brake Inspection', 'maintenance', 20000, 730),
  ('Air Filter',       'maintenance', 20000, 730),
  ('Cabin Filter',     'maintenance', 15000, 540)
) AS t(name, category_type, interval_miles, interval_days)
WHERE NOT EXISTS (SELECT 1 FROM global_categories);

-- 9. Category requests from users
CREATE TABLE IF NOT EXISTS category_requests (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  vehicle_id      UUID    REFERENCES vehicles(id) ON DELETE SET NULL,
  name            TEXT    NOT NULL,
  description     TEXT,
  interval_miles  INTEGER,
  interval_days   INTEGER,
  status          TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE category_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_insert_requests" ON category_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_and_admin_read_requests" ON category_requests
  FOR SELECT USING (auth.uid() = user_id OR get_my_role() = 'admin');

CREATE POLICY "admin_update_requests" ON category_requests
  FOR UPDATE USING (get_my_role() = 'admin');

-- 10. Foreign key from service_categories → global_categories (deferred, table now exists)
ALTER TABLE service_categories
  ADD CONSTRAINT fk_global_category
  FOREIGN KEY (global_category_id) REFERENCES global_categories(id)
  ON DELETE SET NULL
  NOT VALID;

-- =============================================================
-- 11. Explicit grants for PostgREST / supabase-js Data API access
--     Required for new projects after May 30 2026, and for all
--     projects after October 30 2026. Safe to include always.
-- =============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- user_profiles: only authenticated users (no anonymous access needed)
GRANT SELECT, INSERT, UPDATE ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;

-- global_categories: all authenticated users can read; RLS restricts writes to admin
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.global_categories TO authenticated;
GRANT ALL ON TABLE public.global_categories TO service_role;

-- category_requests: authenticated users can submit and read their own; admin reads all
GRANT SELECT, INSERT, UPDATE ON TABLE public.category_requests TO authenticated;
GRANT ALL ON TABLE public.category_requests TO service_role;

-- =============================================================
-- After running this migration, bootstrap your admin account:
--
--   INSERT INTO user_profiles (id, email, role)
--   VALUES ('<your-uuid-from-auth-users>', 'vinitvaru96@gmail.com', 'admin')
--   ON CONFLICT (id) DO UPDATE SET role = 'admin';
--
-- Find your UUID in Supabase → Authentication → Users.
-- =============================================================
