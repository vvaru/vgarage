-- =============================================================
-- Explicit Data API grants for all vGarage tables
-- Run in Supabase SQL Editor — safe to run at any time, idempotent.
--
-- Required because Supabase is removing automatic public schema
-- exposure from the Data API (PostgREST / supabase-js):
--   • New projects:        May 30 2026
--   • All existing tables: October 30 2026
--
-- RLS policies still control which *rows* each user can see/modify.
-- These grants just allow PostgREST to expose the tables at all.
-- =============================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── Core tables (schema.sql) ─────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicles          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_logs      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_logs         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_reminders TO authenticated;

-- ── v2 additions (schema_v2.sql) ─────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_categories         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_category_products  TO authenticated;

-- ── Products (add_products_tables.sql) ───────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_links          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_category_links TO authenticated;

-- service_log_products join table (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'service_log_products') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_log_products TO authenticated;
  END IF;
END $$;

-- ── Admin tables (add_admin_tables.sql) ──────────────────────
-- These tables may not exist yet if you haven't run that migration.
-- The DO block makes this script safe to run before or after.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_profiles') THEN
    GRANT SELECT, INSERT, UPDATE ON public.user_profiles TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'global_categories') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.global_categories TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'category_requests') THEN
    GRANT SELECT, INSERT, UPDATE ON public.category_requests TO authenticated;
  END IF;
END $$;

-- ── service_role gets full access to everything ───────────────
-- (needed for Edge Functions and server-side operations)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- =============================================================
-- Tip: for any table you add in the future, include this at the
-- bottom of that migration file:
--
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;
--   GRANT ALL ON public.<table> TO service_role;
-- =============================================================
