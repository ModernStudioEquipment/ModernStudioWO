-- More than one picture per CNC Catalog part.
--
-- A part had one image slot, the blueprint. The shop asked for more: the
-- finished part from a couple of angles, the fixture, the setup on the machine.
-- They live in an ordered list beside the blueprint rather than replacing it,
-- so every existing part keeps its blueprint exactly where it was.
--
-- jsonb array of public image URLs (same storage bucket the blueprint uses).
alter table public.cnc_parts
  add column if not exists photos jsonb not null default '[]'::jsonb;

-- The wall monitors read the catalogue through this client-free view, which
-- names its columns one by one — so a column the view doesn't list never
-- reaches a monitor. Same column list as 0044, plus photos. Still nothing
-- here that identifies a customer: parts are how to make things, not orders.
drop view if exists public.floor_cnc_parts;
create view public.floor_cnc_parts
  with (security_invoker = false, security_barrier = true) as
select sku, name, steps, blueprint_url, material, notes, product_no, program_no, photos
from public.cnc_parts;
revoke all on public.floor_cnc_parts from public;
grant select on public.floor_cnc_parts to anon, authenticated;

comment on column public.cnc_parts.photos is
  'Extra pictures of the part (finished part, fixture, setup), in display order. The blueprint stays in blueprint_url.';
