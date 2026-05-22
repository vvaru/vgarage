-- vGarage v0.3 schema additions
-- Run in Supabase SQL Editor AFTER schema_v2.sql

-- Groups multiple service items logged in a single session
ALTER TABLE service_logs ADD COLUMN IF NOT EXISTS session_id UUID;
CREATE INDEX IF NOT EXISTS service_logs_session_id_idx ON service_logs(session_id) WHERE session_id IS NOT NULL;
