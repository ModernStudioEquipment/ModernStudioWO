-- Custom / standalone work orders created from the Work Order tab, by department
-- (basic, sewing, saw). These are ad-hoc shop work orders, distinct from the
-- per-item work orders derived from customer orders. `fields` is a JSON blob of
-- the filled form values — its shape varies by department, so adding new form
-- types or fields never needs a schema change.

create table public.work_orders (
  id         uuid primary key default gen_random_uuid(),
  order_no   text,  -- shop-wide order number (shares the orders sequence)
  type       text not null default 'shop' check (type in ('shop', 'cnc', 'sewing', 'saw')),
  title      text not null default '',
  fields     jsonb not null default '{}'::jsonb,
  done       boolean not null default false,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index work_orders_created_at_idx on public.work_orders(created_at desc);

alter table public.work_orders enable row level security;

create policy "office full access" on public.work_orders
  for all to authenticated using (true) with check (true);

-- realtime (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_orders'
  ) then
    alter publication supabase_realtime add table public.work_orders;
  end if;
end $$;
