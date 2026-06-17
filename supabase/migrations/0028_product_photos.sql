-- 0028: product photo library. A photo uploaded for a product is remembered by
-- product NAME, so every order with that product shows it (existing + future)
-- without re-uploading. Items still keep their own image_url; the library is the
-- fallback when an item has none.

create table if not exists public.product_photos (
  name       text primary key,
  image_url  text not null,
  updated_at timestamptz not null default now()
);

alter table public.product_photos enable row level security;
drop policy if exists product_photos_all on public.product_photos;
create policy product_photos_all on public.product_photos for all to authenticated using (true) with check (true);
