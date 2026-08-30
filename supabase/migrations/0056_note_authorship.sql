-- 0056: who wrote a note, and who changed it.
--
-- Notes were anonymous text. On a board 30 people share, "asked Tube Service
-- for 20ft, waiting on price" is only actionable if you know who to ask about
-- it and whether it's from this morning or three weeks ago — and a note someone
-- quietly rewrote read exactly like the original.
--
-- Two facts per note, deliberately separate: the FIRST author, and the LAST
-- editor. One pair would lose whichever it didn't store.
--
-- Applies to the three notes people actually write and rewrite. Notes captured
-- once at a moment that already records a person (received_note, ship_notes)
-- are left alone.
alter table public.orders    add column if not exists notes_by        text;
alter table public.orders    add column if not exists notes_at        timestamptz;
alter table public.orders    add column if not exists notes_edited_by text;
alter table public.orders    add column if not exists notes_edited_at timestamptz;

alter table public.items     add column if not exists note_by         text;
alter table public.items     add column if not exists note_at         timestamptz;
alter table public.items     add column if not exists note_edited_by  text;
alter table public.items     add column if not exists note_edited_at  timestamptz;

alter table public.materials add column if not exists note_by         text;
alter table public.materials add column if not exists note_at         timestamptz;
alter table public.materials add column if not exists note_edited_by  text;
alter table public.materials add column if not exists note_edited_at  timestamptz;

-- Deliberately NOT backfilled. Existing notes have no recorded author, and
-- guessing one (the order's creator, say) would put a name against words that
-- person may never have written. They show as undated until someone edits them.
comment on column public.orders.notes_by    is 'Who first wrote the current note. Null for notes predating 0056.';
comment on column public.items.note_by      is 'Who first wrote the current note. Null for notes predating 0056.';
comment on column public.materials.note_by  is 'Who first wrote the current note. Null for notes predating 0056.';
