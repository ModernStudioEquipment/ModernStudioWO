-- 0048: Floor photo lookup by product name via a function (handles inch-marks).
--
-- supabase-js `.in('norm', [...])` serializes the list into the URL, and a value
-- containing a double-quote (inch marks like 12" / 5/8", which most product
-- names have) silently matches nothing. A function taking a text[] binds the
-- values in the request body, sidestepping URL serialization entirely, while
-- staying targeted (only the names asked for) — light on the free tier.
--
-- The norm expression matches normName() in FloorDisplay.jsx:
--   btrim(regexp_replace(lower(x), '\s+', ' ', 'g'))
create or replace function public.floor_photos_by_name(p_names text[])
returns table (norm text, image_url text)
language sql
security definer
stable
set search_path = public
as $$
  select btrim(regexp_replace(lower(p.name), '\s+', ' ', 'g')) as norm, p.image_url
  from public.product_photos p
  where btrim(regexp_replace(lower(p.name), '\s+', ' ', 'g')) = any (
    select btrim(regexp_replace(lower(n), '\s+', ' ', 'g')) from unnest(p_names) as n
  );
$$;

revoke all on function public.floor_photos_by_name(text[]) from public;
grant execute on function public.floor_photos_by_name(text[]) to anon, authenticated;
