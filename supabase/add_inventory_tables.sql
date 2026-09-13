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

-- ── Product types: WHAT a thing is, above the specific model you bought ──────
-- "Transmission Fluid" is the type; Honda HCF2 and Valvoline Maxlife ATF are
-- models of it. Service categories link to the TYPE, so any model satisfies the
-- job, and a receipt can say "Transmission Fluid" instead of a part number.
CREATE TABLE IF NOT EXISTS product_types (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users NOT NULL,
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Nullable: existing products keep working untyped until one is assigned.
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type_id uuid
  REFERENCES product_types(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS product_type_category_links (
  product_type_id uuid REFERENCES product_types(id) ON DELETE CASCADE NOT NULL,
  category_id     uuid REFERENCES service_categories(id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (product_type_id, category_id)
);

ALTER TABLE product_types                ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_type_category_links  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own product_types" ON product_types;
CREATE POLICY "own product_types" ON product_types FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own product_type_category_links" ON product_type_category_links;
CREATE POLICY "own product_type_category_links" ON product_type_category_links FOR ALL
  USING (EXISTS (SELECT 1 FROM product_types t WHERE t.id = product_type_category_links.product_type_id AND t.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM product_types t WHERE t.id = product_type_category_links.product_type_id AND t.user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON product_types, product_type_category_links TO authenticated;
GRANT ALL ON product_types, product_type_category_links TO service_role;

CREATE INDEX IF NOT EXISTS products_type_idx ON products(product_type_id);
CREATE INDEX IF NOT EXISTS product_type_category_links_type_idx ON product_type_category_links(product_type_id);

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

-- What a shop would have charged for this same job. Optional, and only
-- meaningful on DIY records — the gap against actual cost is the DIY saving.
ALTER TABLE service_logs ADD COLUMN IF NOT EXISTS shop_equivalent_cost numeric;

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

-- =============================================================================
-- Tire tracking
--
-- A tire is not like oil. Oil is fungible and consumed — 5 qt is 5 qt, FIFO
-- works. A tire is an INDIVIDUAL (this one has 22k on it, that one is new) and
-- it is not consumed: it comes off, sits in the garage, and goes back on next
-- season carrying its history. So tires are instance-tracked, and mileage
-- accrues only while a tire is actually mounted.
-- =============================================================================

-- The install-once table from the first pass could express neither storage nor
-- rotation. Superseded before it held anything real.
DROP TABLE IF EXISTS tire_installations CASCADE;

-- A category that fits tires reveals a tire picker when it's logged. A FLAG,
-- not a name match: "Tire Replacement" / "Tires Replaced" / "New Tires" are one
-- intent, and "Tire Rotation" must not be confused with fitting new rubber.
ALTER TABLE service_categories ADD COLUMN IF NOT EXISTS tracks_tires boolean NOT NULL DEFAULT false;

-- Directional tread is a property of the TIRE MODEL, not of the car: the tread
-- is cut to turn one way, so such a tire may only move front<->back on its own
-- side. (A car CAN impose its own limit — staggered fitment, different sizes
-- front and rear — but that's a separate constraint and this car doesn't have
-- it.) Since a product IS the model, the flag belongs here and every instance
-- inherits it.
-- Deliberately nullable with no default: NULL means "never said", which is a
-- different answer from false. Treating unknown as non-directional would let the
-- app recommend a crossing pattern that runs a directional tread backwards.
ALTER TABLE products ADD COLUMN IF NOT EXISTS tire_directional boolean;

-- Some people don't want to say which corner each tire is on. Turning this off
-- keeps tracking mileage (that doesn't depend on corners) but stops showing and
-- asking for positions. Per car, because it's a property of how you keep THIS
-- car's records.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS track_tire_positions boolean NOT NULL DEFAULT true;

-- One physical tire. product_id is the MODEL it is an instance of, so a receipt
-- line of "4 x CrossClimate2" spawns four of these and the existing product /
-- receipt / cost machinery is reused rather than duplicated.
CREATE TABLE IF NOT EXISTS tires (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid REFERENCES auth.users NOT NULL,
  product_id          uuid REFERENCES products(id) ON DELETE SET NULL,
  receipt_item_id     uuid REFERENCES receipt_items(id) ON DELETE SET NULL,
  label               text,          -- optional: DOT code, "winter #2", anything
  expected_life_miles integer,
  purchased_date      date,
  retired_date        date,          -- set when it's scrapped; null = still owned
  retired_reason      text,
  created_at          timestamptz DEFAULT now()
);

-- Where a tire is, over time. position NULL = taken off and stored, which is
-- what makes seasonal swapping work: mileage stops accruing between a removal
-- and the next fitting.
CREATE TABLE IF NOT EXISTS tire_events (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users NOT NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
  tire_id    uuid REFERENCES tires(id) ON DELETE CASCADE NOT NULL,
  log_id     uuid REFERENCES service_logs(id) ON DELETE SET NULL,
  position   text,                   -- FL | FR | RL | RR, or NULL when removed
  odometer   integer NOT NULL,
  date       date NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tires       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tire_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own tires" ON tires;
CREATE POLICY "own tires" ON tires FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own tire_events" ON tire_events;
CREATE POLICY "own tire_events" ON tire_events FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON tires, tire_events TO authenticated;
GRANT ALL ON tires, tire_events TO service_role;

CREATE INDEX IF NOT EXISTS tires_product_idx ON tires(product_id);
CREATE INDEX IF NOT EXISTS tire_events_tire_idx ON tire_events(tire_id, odometer);
CREATE INDEX IF NOT EXISTS tire_events_vehicle_idx ON tire_events(vehicle_id, odometer DESC);
CREATE INDEX IF NOT EXISTS tire_events_log_idx ON tire_events(log_id);
