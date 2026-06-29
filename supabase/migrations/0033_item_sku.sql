-- 0033: per-item SKU. Lets us match an item to its product photo by SKU instead
-- of by the (inconsistent) product name. Nullable + additive: getOrders() does
-- select("*, items(...)") so existing callers are unaffected, and nothing reads
-- this column until the photo wiring lands. The column starts empty, so the index
-- builds instantly with no table lock.
alter table public.items add column if not exists sku text;
create index if not exists items_sku_idx on public.items (sku);
