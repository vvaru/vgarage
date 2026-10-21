-- =============================================================================
-- Change a product's unit without corrupting its stock history.
-- Run in Supabase SQL Editor. Idempotent (CREATE OR REPLACE), safe to re-run.
--
-- Every quantity for a product is a bare number "in the product's unit":
-- receipt_items.qty, inventory_adjustments.qty_delta, service_product_usage.qty.
-- Relabelling products.unit alone would silently reinterpret all of them
-- (1 can → 1 qt). This rescales them together, in one transaction:
--   1 old unit = p_factor new units
--   quantities × p_factor, per-unit costs ÷ p_factor (so money totals don't move).
--
-- p_from_unit must match the product's current unit, so a repeated call (a retry
-- after a dropped connection) fails instead of converting twice.
--
-- SECURITY INVOKER: runs under the caller's RLS, so it can only touch rows the
-- signed-in user owns. A product they can't see fails with "product not found"
-- and nothing changes.
-- =============================================================================

DROP FUNCTION IF EXISTS convert_product_unit(uuid, text, numeric);

CREATE OR REPLACE FUNCTION convert_product_unit(p_product_id uuid, p_from_unit text, p_new_unit text, p_factor numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_factor IS NULL OR p_factor <= 0 THEN
    RAISE EXCEPTION 'conversion factor must be a positive number';
  END IF;
  IF coalesce(trim(p_new_unit), '') = '' THEN
    RAISE EXCEPTION 'new unit is required';
  END IF;

  UPDATE products SET unit = trim(p_new_unit) WHERE id = p_product_id AND unit = p_from_unit;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found, or its unit is no longer %', p_from_unit;
  END IF;

  UPDATE receipt_items
     SET qty = qty * p_factor, unit_cost = unit_cost / p_factor
   WHERE product_id = p_product_id;

  UPDATE inventory_adjustments
     SET qty_delta = qty_delta * p_factor, unit_cost = unit_cost / p_factor
   WHERE product_id = p_product_id;

  UPDATE service_product_usage
     SET qty = qty * p_factor, unit_cost = unit_cost / p_factor
   WHERE product_id = p_product_id;
END
$$;

GRANT EXECUTE ON FUNCTION convert_product_unit(uuid, text, text, numeric) TO authenticated;
