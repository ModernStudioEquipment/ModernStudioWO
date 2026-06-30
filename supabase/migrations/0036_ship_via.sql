-- 0036: the shipping method — QuickBooks' "Ship Via" (ShipMethodRef, e.g.
-- "UPS Ground", "Will Call", "Best Way") and Shopify's chosen shipping line.
-- Shown next to Ship To on the order. Populated by the QB sync + Shopify webhook;
-- backfill existing QB orders with the conductor-sync ?shiptoBackfillDays=N pass.
alter table public.orders add column if not exists ship_via text;
