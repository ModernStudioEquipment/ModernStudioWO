-- Costing / margins.
--
-- Three tables:
--   cost_inputs        the shared library — raw materials, labor rates, anything
--                      else with a unit price. ONE place per thing.
--   product_costs      a product we've costed out (+ what we sell it for).
--   product_cost_lines the recipe: how much of each input that product takes.
--
-- Line cost is deliberately NOT stored. A line records the QUANTITY only, and
-- cost is computed as qty x the input's CURRENT unit_price. That's what makes
-- "update the price of a raw material and every product using it updates" work
-- for free — there's no cached price anywhere to go stale.

create table if not exists public.cost_inputs (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null default 'material' check (kind in ('material', 'labor', 'other')),
  name             text not null,
  unit             text not null default 'each',   -- ft, yd, each, lb, hr…
  unit_price       numeric(12,4) not null default 0,
  vendor           text,
  sku              text,
  note             text,
  price_updated_at timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists public.product_costs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,        -- matches items.name
  sku        text,
  sell_price numeric(12,2),
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.product_cost_lines (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product_costs(id) on delete cascade,
  input_id   uuid references public.cost_inputs(id) on delete set null,
  qty        numeric(12,4) not null default 1,
  note       text,
  position   int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists cost_inputs_kind_idx on public.cost_inputs(kind);
create index if not exists product_cost_lines_product_idx on public.product_cost_lines(product_id);

alter table public.cost_inputs enable row level security;
alter table public.product_costs enable row level security;
alter table public.product_cost_lines enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cost_inputs', 'product_costs', 'product_cost_lines'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'office full access'
    ) then
      execute format('create policy "office full access" on public.%I for all to authenticated using (true) with check (true)', t);
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
