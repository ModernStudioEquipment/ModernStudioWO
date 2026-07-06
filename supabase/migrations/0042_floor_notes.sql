-- 0042: Per-job floor notes.
--
-- A quick note the office types on the Floor Control queue page for one specific
-- queued item; it shows next to the image on that department's wall monitor so
-- the crew reads it before building. Distinct from cnc_parts.notes (which is a
-- reusable per-PART note); this is per queued ITEM.
--
-- Kept in its own table (not items.note, which is excluded from the floor for
-- privacy) so it's authored specifically for the floor and safe to expose to the
-- anon monitor. Additive + safe.
create table if not exists public.floor_notes (
  item_id    uuid primary key references public.items(id) on delete cascade,
  note       text,
  updated_at timestamptz not null default now()
);

alter table public.floor_notes enable row level security;
drop policy if exists floor_notes_rw on public.floor_notes;
create policy floor_notes_rw on public.floor_notes
  for all to authenticated using (true) with check (true);

-- Client-free read for the anon monitor.
drop view if exists public.floor_item_notes;
create view public.floor_item_notes
  with (security_invoker = false, security_barrier = true) as
select item_id, note
from public.floor_notes;

comment on view public.floor_item_notes is
  'Per-item floor notes typed on the queue page, shown on the monitor. No customer data.';

revoke all on public.floor_item_notes from public;
grant select on public.floor_item_notes to anon, authenticated;
