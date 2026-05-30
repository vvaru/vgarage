-- Run this in Supabase SQL Editor > New Query
-- Adds session_id to service_logs so multi-service visits are grouped together
ALTER TABLE service_logs
  ADD COLUMN IF NOT EXISTS session_id uuid DEFAULT NULL;
