-- 0034: item photo library keyed by SKU. The pick list and work orders look up
-- an item's photo by its SKU. QuickBooks items carry the SKU in their "Item #:"
-- note (so no per-item write is needed); Shopify items keep their own image_url.
-- A photo uploaded here for a SKU shows on every order with that item, existing
-- and future, with zero per-order work. The adapter tolerates this table being
-- absent, exactly like product_photos (0028), so nothing breaks before it exists.
create table if not exists public.item_photos (
  sku        text primary key,
  image_url  text not null,
  updated_at timestamptz not null default now()
);

alter table public.item_photos enable row level security;
drop policy if exists item_photos_all on public.item_photos;
create policy item_photos_all on public.item_photos for all to authenticated using (true) with check (true);
