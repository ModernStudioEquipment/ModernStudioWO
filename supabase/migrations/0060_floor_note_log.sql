-- 0060: floor notes lock the moment they're written, like every other note.
--
-- A note typed on the Floor Control queue used to be one editable row per job:
-- whoever typed last overwrote whatever was there, unattributed and undated. On
-- a board thirty people share that loses the record by design -- "wrong material,
-- see Adrian" and the reply to it cannot both exist.
--
-- Same rule as the order/item/material notes (0057): a note is IMMUTABLE once
-- written, carries who wrote it and when, and adding to it means adding another.
-- The policies below allow insert and select only -- no update, no delete -- so
-- it can't be quietly rewritten even by a direct API call.
--
-- Kept separate from public.notes on purpose. That table holds the office's own
-- note text (materials, items, orders) and is authenticated-only; THIS text is
-- written for the floor and is the only note the anon monitor may read. Two
-- tables, two audiences, no chance of one leaking through the other.

create table if not exists public.floor_note_log (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null,     -- an items id OR a work_orders id (see 0059)
  body       text not null,
  author     text,              -- null when we genuinely don't know (see backfill)
  created_at timestamptz not null default now()
);

create index if not exists floor_note_log_item_idx
  on public.floor_note_log(item_id, created_at);

alter table public.floor_note_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='floor_note_log' and policyname='floor notes readable') then
    create policy "floor notes readable" on public.floor_note_log for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='floor_note_log' and policyname='floor notes insertable') then
    create policy "floor notes insertable" on public.floor_note_log for insert to authenticated with check (true);
  end if;
  -- Deliberately NO update or delete policy. That's what makes a note locked.
end $$;

-- Carry the existing one-per-job notes across so nothing is lost. The author is
-- left NULL rather than invented -- we don't know who typed them -- and the date
-- is the row's own updated_at, which is the last time it was touched.
insert into public.floor_note_log (item_id, body, author, created_at)
select n.item_id, n.note, null, n.updated_at
  from public.floor_notes n
 where coalesce(trim(n.note), '') <> ''
   and not exists (
     select 1 from public.floor_note_log l
      where l.item_id = n.item_id and l.body = n.note
   );

-- The monitor's read. `note` keeps its old name so a monitor running the
-- previous build still shows the text; author and created_at are new.
drop view if exists public.floor_item_notes;

create view public.floor_item_notes
  with (security_invoker = false, security_barrier = true) as
select item_id, body as note, author, created_at
from public.floor_note_log;

comment on view public.floor_item_notes is
  'Append-only floor notes typed on the queue page, shown on the monitor. One row '
  'per note, oldest first by created_at. Written FOR the floor: no customer data.';

revoke all on public.floor_item_notes from public;
grant select on public.floor_item_notes to anon, authenticated;

-- public.floor_notes (the old single-row table) is left in place and untouched:
-- nothing writes it from here on, and it is the way back if this needs undoing.

-- ---------------------------------------------------------------------------
-- VERIFY (run in the SQL editor after applying)
--   select item_id, note, author, created_at from public.floor_item_notes limit 5;
--   -- and prove a note can't be rewritten:
--   update public.floor_note_log set body = 'nope';   -- 0 rows: no update policy
-- ---------------------------------------------------------------------------
