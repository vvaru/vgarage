-- Lets a product with history be archived: hidden from lists and pickers, with its
-- purchases and uses kept. Safe to run more than once.
-- Run once in the Supabase SQL editor.
alter table products add column if not exists archived_at timestamptz;
