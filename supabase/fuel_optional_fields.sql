-- Make fuel-log fields optional so a fill-up can be logged with minimal info.
-- Run once in the Supabase SQL editor.
alter table fuel_logs
  alter column gallons          drop not null,
  alter column price_per_gallon drop not null,
  alter column total_cost       drop not null;
