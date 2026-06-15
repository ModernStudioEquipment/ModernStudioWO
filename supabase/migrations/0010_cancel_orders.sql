-- 0010: cancel an order while keeping the record. Instead of deleting, an order
-- is marked cancelled (with a reason + timestamp); the app hides cancelled
-- orders from the active boards but the row stays for the record. Additive/safe.

alter table public.orders add column if not exists cancelled_at  timestamptz;
alter table public.orders add column if not exists cancel_reason text;
