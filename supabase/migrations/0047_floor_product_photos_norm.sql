-- 0047: Match floor photos by a NORMALIZED product name.
--
-- 0046 exposed product_photos by exact name, but item names and library names
-- differ in casing / spacing / punctuation, so an exact `in (...)` match found
-- very few. Add a normalized key (lowercased, collapsed whitespace, trimmed) so
-- the floor can look photos up by the same normalization it does client-side —
-- targeted (only the names on screen), which lifts coverage to ~75% without
-- pulling the whole 5,773-row library.
--
-- The `norm` expression MUST stay in sync with normName() in FloorDisplay.jsx:
--   js:  name.toLowerCase().replace(/\s+/g, ' ').trim()
--   sql: btrim(regexp_replace(lower(name), '\s+', ' ', 'g'))
drop view if exists public.floor_product_photos;

create view public.floor_product_photos
  with (security_invoker = false, security_barrier = true) as
select
  name,
  image_url,
  btrim(regexp_replace(lower(name), '\s+', ' ', 'g')) as norm
from public.product_photos;

comment on view public.floor_product_photos is
  'Product-name -> photo for the floor monitor, with a normalized lookup key. No customer data.';

revoke all on public.floor_product_photos from public;
grant select on public.floor_product_photos to anon, authenticated;
