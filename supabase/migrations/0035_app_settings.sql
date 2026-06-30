-- 0035_app_settings.sql
-- Shared key/value settings for the board. First use: the team-wide manual
-- order of the Orders tab (key "orders_manual" -> JSON array of order ids).
-- One row per key. Tiny: read on every board refetch, written on each reorder.

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Same access model as the rest of the board: any signed-in employee can read
-- and write. (The whole crew shares one workspace.)
drop policy if exists app_settings_rw on public.app_settings;
create policy app_settings_rw on public.app_settings
  for all to authenticated
  using (true) with check (true);

-- Push a reorder to every open board in realtime, exactly like orders/items.
-- Guarded so re-running the migration doesn't error if it's already a member.
do $$
begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null;
end $$;
