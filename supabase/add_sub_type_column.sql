-- Run this in Supabase SQL Editor > New Query
ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS sub_type text DEFAULT 'service';

-- Auto-assign 'check' to categories with 'check' or 'inspection' in their name
UPDATE service_categories
SET sub_type = 'check'
WHERE category_type = 'maintenance'
  AND (LOWER(name) LIKE '%check%' OR LOWER(name) LIKE '%inspection%');
