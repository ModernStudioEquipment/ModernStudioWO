-- 0024: order-level notes (free text). Shown in the order detail; a bell signal
-- appears on the order card when notes are present. Additive/safe.

alter table public.orders add column if not exists notes text;
