-- Performance: stop shipping the whole event log with the board.
--
-- getOrders() selected item_events(*) alongside every item, so opening the board
-- downloaded ~14,000 timeline rows (3.8 MB, ~28 SECONDS) — even though the only
-- thing the board needs from them is ONE value per item: when it entered its
-- current stage (this drives the sitting / stale badges and the dashboard's
-- "needs attention" list). Full timelines are only ever read when someone
-- expands "View timeline" on a single item.
--
-- So: keep that one value on the item itself, maintained by a trigger. The board
-- query drops item_events entirely (0.6s), and timelines load on demand.

alter table public.items add column if not exists stage_entered_at timestamptz;

-- Backfill from the existing log: the most recent created/moved event that landed
-- the item in the stage it's in now. Falls back to the item's own created_at.
update public.items i
set stage_entered_at = coalesce(
  (select max(e.created_at) from public.item_events e
    where e.item_id = i.id and e.kind in ('created', 'moved') and e.to_val = i.stage),
  i.created_at
)
where i.stage_entered_at is null;

-- Maintain it going forward. BEFORE so we can just set the column on the row.
create or replace function public.touch_stage_entered_at() returns trigger
language plpgsql as $$
begin
  if (TG_OP = 'INSERT') then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif (new.stage is distinct from old.stage) then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists items_stage_entered_at on public.items;
create trigger items_stage_entered_at
  before insert or update on public.items
  for each row execute function public.touch_stage_entered_at();
