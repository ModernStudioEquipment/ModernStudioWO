-- 0041: The CNC parts library — the home for "how to make it" content.
--
-- One row per CNC part: the make-steps, a blueprint image, material, and notes.
-- Authored by the office in the Floor Control > CNC Library editor; displayed on
-- the CNC wall monitor for whatever part is up next. Keyed loosely by SKU (to
-- auto-match the item on the monitor) with a human name fallback.
--
-- None of this is customer data, so like the other floor content it is exposed
-- to the anon monitor through a client-free view. Additive + safe.
create table if not exists public.cnc_parts (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique,                         -- optional link to items.sku
  name          text not null,                       -- part name / title
  steps         jsonb not null default '[]'::jsonb,  -- ordered array of step strings
  blueprint_url text,                                -- blueprint / drawing image
  material      text,
  notes         text,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

alter table public.cnc_parts enable row level security;
drop policy if exists cnc_parts_rw on public.cnc_parts;
create policy cnc_parts_rw on public.cnc_parts
  for all to authenticated using (true) with check (true);

-- Client-free read for the anon monitor.
drop view if exists public.floor_cnc_parts;
create view public.floor_cnc_parts
  with (security_invoker = false, security_barrier = true) as
select sku, name, steps, blueprint_url, material, notes
from public.cnc_parts;

comment on view public.floor_cnc_parts is
  'CNC make-steps + blueprint per part, for the floor monitor. No customer data.';

revoke all on public.floor_cnc_parts from public;
grant select on public.floor_cnc_parts to anon, authenticated;
