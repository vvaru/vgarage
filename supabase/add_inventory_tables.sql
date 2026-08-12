-- =============================================================================
-- Inventory & Receipts — Phase 1 schema
-- Run in Supabase SQL Editor. Additive & idempotent (safe to re-run).
--
-- NOTE: local and prod share this one Supabase project, but everything here is
-- purely additive (new tables, new nullable/defaulted columns). The live app
-- ignores all of it until the feature ships, so running this now does NOT affect
-- production behavior.
-- =============================================================================

-- ── Products become garage-wide + carry a unit ──────────────────────────────
-- vehicle_id is already nullable; new products will be created with it NULL and
-- scoped by user_id instead. Existing per-vehicle products keep working.
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'each';

-- ── Receipts: a purchase (with line items) OR a standalone image (labor bill) ─
CREATE TABLE IF NOT EXISTS receipts (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users NOT NULL,
  date        date,
  store       text,
  image_path  text,          -- path in the existing 'receipts' storage bucket (nullable)
  total_cost  numeric,       -- optional; for reconciliation against line items
  note        text,
  created_at  timestamptz DEFAULT now()
);

-- Explicitly "this receipt is labour/services only". Distinguishes a receipt the
-- user has confirmed carries no stock from one they simply haven't filled in yet,
-- so the former stops nagging in "past receipts to import".
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS no_products boolean NOT NULL DEFAULT false;

-- ── Receipt line items = inventory LOTS (remaining balance derived from usage) ─
CREATE TABLE IF NOT EXISTS receipt_items (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id  uuid REFERENCES receipts(id) ON DELETE CASCADE NOT NULL,
  product_id  uuid REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  qty         numeric NOT NULL,   -- amount purchased, in the product's unit
  unit_cost   numeric,            -- price per unit (drives auto-cost)
  created_at  timestamptz DEFAULT now()
);

-- ── Manual inventory adjustments (opening stock, corrections, spillage) ───────
-- Positive qty_delta behaves like a lot (a receipt-less purchase); negative draws down.
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users NOT NULL,
  product_id  uuid REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  qty_delta   numeric NOT NULL,
  unit_cost   numeric,
  note        text,
  date        date,
  created_at  timestamptz DEFAULT now()
);

-- ── Service usage, allocated to a specific lot (FIFO) ────────────────────────
-- A usage spanning two lots = two rows (same log_id + product_id, different lot).
-- receipt_item_id NULL = drawn from un-lotted / manual stock (or over-drawn).
CREATE TABLE IF NOT EXISTS service_product_usage (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  log_id          uuid REFERENCES service_logs(id) ON DELETE CASCADE NOT NULL,
  product_id      uuid REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  receipt_item_id uuid REFERENCES receipt_items(id) ON DELETE SET NULL,
  qty             numeric NOT NULL,
  unit_cost       numeric,        -- captured from the lot at time of use
  created_at      timestamptz DEFAULT now()
);

-- ── Direct receipt attachments to a service (labor bills / extra images) ──────
-- Inventory-derived receipts are found via service_product_usage, so this table is
-- only for receipts attached directly (no line-item/inventory involvement).
CREATE TABLE IF NOT EXISTS service_log_receipts (
  log_id      uuid REFERENCES service_logs(id) ON DELETE CASCADE NOT NULL,
  receipt_id  uuid REFERENCES receipts(id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (log_id, receipt_id)
);

-- ── Service logs: a manual labor/other cost on top of auto parts cost ─────────
ALTER TABLE service_logs ADD COLUMN IF NOT EXISTS labor_cost numeric;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE receipts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_product_usage  ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_log_receipts   ENABLE ROW LEVEL SECURITY;

-- DROP+CREATE so this stays idempotent (CREATE POLICY has no IF NOT EXISTS).
DROP POLICY IF EXISTS "own receipts" ON receipts;
CREATE POLICY "own receipts" ON receipts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own adjustments" ON inventory_adjustments;
CREATE POLICY "own adjustments" ON inventory_adjustments FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own receipt_items" ON receipt_items;
CREATE POLICY "own receipt_items" ON receipt_items FOR ALL
  USING (EXISTS (SELECT 1 FROM receipts r WHERE r.id = receipt_items.receipt_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM receipts r WHERE r.id = receipt_items.receipt_id AND r.user_id = auth.uid()));

DROP POLICY IF EXISTS "own usage" ON service_product_usage;
CREATE POLICY "own usage" ON service_product_usage FOR ALL
  USING (EXISTS (SELECT 1 FROM service_logs s WHERE s.id = service_product_usage.log_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM service_logs s WHERE s.id = service_product_usage.log_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "own service_log_receipts" ON service_log_receipts;
CREATE POLICY "own service_log_receipts" ON service_log_receipts FOR ALL
  USING (EXISTS (SELECT 1 FROM service_logs s WHERE s.id = service_log_receipts.log_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM service_logs s WHERE s.id = service_log_receipts.log_id AND s.user_id = auth.uid()));

-- ── Grants (PostgREST exposure; RLS still controls which rows) ────────────────
GRANT SELECT, INSERT, UPDATE, DELETE
  ON receipts, receipt_items, inventory_adjustments, service_product_usage, service_log_receipts
  TO authenticated;
GRANT ALL
  ON receipts, receipt_items, inventory_adjustments, service_product_usage, service_log_receipts
  TO service_role;

-- =============================================================================
-- Helpful (optional) indexes for the inventory/usage queries.
-- =============================================================================
CREATE INDEX IF NOT EXISTS receipt_items_product_idx ON receipt_items(product_id);
CREATE INDEX IF NOT EXISTS receipt_items_receipt_idx ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS service_product_usage_product_idx ON service_product_usage(product_id);
CREATE INDEX IF NOT EXISTS service_product_usage_log_idx ON service_product_usage(log_id);
CREATE INDEX IF NOT EXISTS service_product_usage_lot_idx ON service_product_usage(receipt_item_id);
CREATE INDEX IF NOT EXISTS inventory_adjustments_product_idx ON inventory_adjustments(product_id);
