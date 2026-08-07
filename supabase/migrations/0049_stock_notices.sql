-- Low-stock notices: the Inventory tab.
--
-- Whoever is picking an order is the first to notice a product is running low,
-- but they shouldn't have to stop and write the work order themselves. They post
-- a NOTICE here instead; whoever makes that product picks it up and turns it into
-- a work order. Same idea as Purchasing, but for things we MAKE rather than buy.
--
-- qty_on_hand is free text, like materials.amount — the shop doesn't track
-- numeric stock ("3 left", "half a box", "2 sheets" are all normal).
-- created_at is the immutable "when it was reported" stamp and is never editable.

create table if not exists public.stock_notices (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                    -- the product running low
  qty_on_hand   text,                             -- free text
  dept          text not null default 'Shop',     -- who makes it (Shop/CNC/Sewing/Saw)
  reported_by   text,                             -- who put the notice in
  note          text,
  status        text not null default 'open' check (status in ('open', 'handled')),
  work_order_no text,                             -- the work order raised from it
  handled_by    text,
  handled_at    timestamptz,
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create index if not exists stock_notices_created_at_idx on public.stock_notices(created_at desc);
create index if not exists stock_notices_status_idx on public.stock_notices(status);

alter table public.stock_notices enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_notices' and policyname = 'office full access'
  ) then
    create policy "office full access" on public.stock_notices
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- realtime (idempotent) — a notice posted on the floor shows up on every board
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stock_notices'
  ) then
    alter publication supabase_realtime add table public.stock_notices;
  end if;
end $$;
