-- 0037_orders_unique_active.sql
-- Hard guarantee against duplicate orders. No two ACTIVE (non-cancelled) orders
-- may share the same source + order number — so a duplicate is IMPOSSIBLE to
-- insert, no matter what tries it (a sync misfire, a re-import, a manual entry).
-- Cancelled/hidden rows are exempt, so an order can still be re-created after it's
-- been cancelled. This backs up the sync's own dedup instead of trusting it alone
-- (a July-3 sync run created same-numbered duplicates the dedup should have blocked;
-- the cause couldn't be reproduced, so the DB enforces uniqueness directly).
create unique index if not exists orders_active_order_no_unique
  on public.orders (source, order_no)
  where cancelled_at is null;
