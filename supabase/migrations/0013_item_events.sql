-- 0013: per-item history / timeline. A row is logged every time an item is
-- created, moved between stages, toggled in-progress, or changes department.
-- Recorded by a trigger on `items` so EVERY code path is captured automatically
-- (triage, move-to, pick, mark done, in-progress, dept change). Shown as a
-- timeline in the item pop-up. Additive/safe.

create table if not exists public.item_events (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(id) on delete cascade,
  kind       text not null,            -- 'created' | 'moved' | 'in_progress' | 'dept'
  from_val   text,
  to_val     text,
  created_at timestamptz not null default now()
);

create index if not exists item_events_item_id_idx on public.item_events(item_id);

-- Same access model as the rest of the board: any authenticated staffer.
alter table public.item_events enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'item_events' and policyname = 'office full access'
  ) then
    create policy "office full access" on public.item_events
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Trigger: log meaningful changes. Runs as definer so the insert always lands
-- regardless of which path touched the item.
create or replace function public.log_item_event() returns trigger
language plpgsql security definer as $$
begin
  if (TG_OP = 'INSERT') then
    insert into public.item_events(item_id, kind, to_val) values (new.id, 'created', new.stage);
  elsif (TG_OP = 'UPDATE') then
    if new.stage is distinct from old.stage then
      insert into public.item_events(item_id, kind, from_val, to_val) values (new.id, 'moved', old.stage, new.stage);
    end if;
    if new.in_progress is distinct from old.in_progress then
      insert into public.item_events(item_id, kind, to_val) values (new.id, 'in_progress', new.in_progress::text);
    end if;
    if new.dept is distinct from old.dept then
      insert into public.item_events(item_id, kind, from_val, to_val) values (new.id, 'dept', old.dept, new.dept);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists items_event_log on public.items;
create trigger items_event_log
  after insert or update on public.items
  for each row execute function public.log_item_event();

-- Realtime so the timeline updates live, like the rest of the board.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'item_events'
  ) then
    execute 'alter publication supabase_realtime add table public.item_events';
  end if;
end $$;

-- Backfill: give every existing item a truthful "entered New Orders" event,
-- backdated to when it was created. Past stage transitions from before this
-- migration can't be reconstructed; history is complete from here forward.
insert into public.item_events (item_id, kind, to_val, created_at)
  select i.id, 'created', 'new', i.created_at
  from public.items i
  where not exists (select 1 from public.item_events e where e.item_id = i.id);
