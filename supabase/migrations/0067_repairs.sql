-- 0067: repair tickets (the Repairs tab).
--
-- The paper "MODERN Repairs & Recovers" ticket the will call counter fills in
-- when a client drops something off. Until now only will call knew those
-- repairs existed; this puts them on the board for the office.
--
-- `fields` holds the whole sheet (client, dates, quote yes/no, service counts,
-- item lines), the same way work_orders.fields does, so a box added to the
-- paper later never needs another migration.
--
-- Office only: client names, phones and addresses live here, so there is NO
-- grant to anon and no floor view. Same policy as work_orders.
--
-- Safe to run more than once.

create table if not exists public.repairs (
  id         uuid primary key default gen_random_uuid(),
  status     text not null default 'open' check (status in ('open', 'ready', 'done')),
  fields     jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists repairs_created_at_idx on public.repairs(created_at desc);

alter table public.repairs enable row level security;

drop policy if exists "office full access" on public.repairs;
create policy "office full access" on public.repairs
  for all to authenticated using (true) with check (true);

revoke all on public.repairs from anon;

-- realtime, so a ticket entered at will call shows up on the office's board
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'repairs'
  ) then
    alter publication supabase_realtime add table public.repairs;
  end if;
end $$;
