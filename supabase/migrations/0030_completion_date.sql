-- 0030: per-order "estimated ready-by" completion date.
-- This is the shop's OWN estimate of when an order can be ready — set manually,
-- one date per order. It is deliberately SEPARATE from due_date: it must NOT
-- drive the red/amber urgency or the Urgent tab. Just an informational date that
-- travels with the order. Read via select * + mapOrder; written by setCompletionDate.
alter table public.orders add column if not exists completion_date date;
