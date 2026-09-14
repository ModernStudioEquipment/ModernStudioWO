-- 0057: notes become an append-only log instead of one editable box.
--
-- A single editable note on a board 30 people share loses history by design:
-- whoever types last overwrites whatever was there, and the record of what was
-- known when disappears. Locking each note and requiring a new one to add
-- something keeps the whole thread of what actually happened.
--
-- Notes are therefore IMMUTABLE. There is no update path in the app, and the
-- RLS policies below allow insert and select only — no update, no delete — so
-- a note can't be quietly rewritten even by a direct API call.
create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('order', 'item', 'material')),
  subject_id   uuid not null,
  body         text not null,
  author       text,          -- null when we genuinely don't know (see backfill)
  created_at   timestamptz default now()   -- null on backfilled notes: date unknown
);

create index if not exists notes_subject_idx on public.notes(subject_type, subject_id, created_at);

alter table public.notes enable row level security;

do $$
begin
  -- Read + write for any signed-in staffer, matching the rest of the board.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notes' and policyname='notes readable') then
    create policy "notes readable" on public.notes for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='notes' and policyname='notes insertable') then
    create policy "notes insertable" on public.notes for insert to authenticated with check (true);
  end if;
  -- Deliberately NO update or delete policy. That's what makes a note locked.
end $$;

-- Carry the existing single notes across so nothing is lost. Author and date are
-- left NULL rather than invented: we don't know who wrote them or when, and
-- stamping a guess would put a name and a time against words that may be
-- neither. The app shows these as "author unknown".
insert into public.notes (subject_type, subject_id, body, author, created_at)
select 'order', o.id, o.notes, o.notes_by, o.notes_at
  from public.orders o
 where coalesce(trim(o.notes), '') <> ''
   and not exists (select 1 from public.notes n where n.subject_type='order' and n.subject_id=o.id);

insert into public.notes (subject_type, subject_id, body, author, created_at)
select 'item', i.id, i.note, i.note_by, i.note_at
  from public.items i
 where coalesce(trim(i.note), '') <> ''
   -- NOT the QuickBooks item code. The sync writes "Item #: 013-2410-BZ" into
   -- this same column, and copying those in made 2,838 machine strings look
   -- like notes people had written. A further line means real prose: keep those.
   and not (i.note ~ '^Item #:' and i.note !~ '[\r\n]')
   and not exists (select 1 from public.notes n where n.subject_type='item' and n.subject_id=i.id);

insert into public.notes (subject_type, subject_id, body, author, created_at)
select 'material', m.id, m.note, m.note_by, m.note_at
  from public.materials m
 where coalesce(trim(m.note), '') <> ''
   and not exists (select 1 from public.notes n where n.subject_type='material' and n.subject_id=m.id);
