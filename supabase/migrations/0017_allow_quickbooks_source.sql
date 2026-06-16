-- 0017: allow 'QuickBooks' as an order source (orders synced from QuickBooks
-- Desktop via Conductor). The 0001 check constraint only allowed phone/Shopify.

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check
  check (source in ('phone', 'Shopify', 'QuickBooks'));
