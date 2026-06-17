-- 0021: capture the carrier and a free-text note when an order is marked shipped,
-- alongside the existing tracking number. Additive/safe.

alter table public.orders add column if not exists carrier    text;
alter table public.orders add column if not exists ship_notes text;
