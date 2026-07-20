-- 0046: Let the floor monitors match photos by product NAME too.
--
-- The floor only matched a photo by the item's own image or its SKU. Many items
-- (QuickBooks parts) have neither on the item, so they showed no photo — even
-- though a photo exists in the name-keyed product_photos library. Expose that
-- library (name -> image_url, no customer data) to the anon monitor so photos
-- resolve by product name as a fallback.
drop view if exists public.floor_product_photos;

create view public.floor_product_photos
  with (security_invoker = false, security_barrier = true) as
select name, image_url from public.product_photos;

comment on view public.floor_product_photos is
  'Product-name -> photo for the floor monitor fallback. No customer data.';

revoke all on public.floor_product_photos from public;
grant select on public.floor_product_photos to anon, authenticated;
