-- 0009: Will Call pickups. Records when a will-call order was collected and by
-- whom. Used to mark it "Picked up" in the Will Call tab and to drop it (and
-- shipped orders) off the active Orders list. Additive/safe.

alter table public.orders add column if not exists picked_up_at timestamptz;
alter table public.orders add column if not exists picked_up_by text;
