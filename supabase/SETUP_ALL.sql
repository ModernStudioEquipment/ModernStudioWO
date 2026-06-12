-- Modern Work Order App — complete database setup (paste this whole file
-- into the Supabase dashboard SQL Editor and click Run).

-- ============================================================
-- migrations/0001_init.sql
-- ============================================================
-- Modern Work Order App — Phase 1 schema
-- Core model: Order -> Items (one per product) -> Materials (free-text amounts).
-- Triage and routing are PER ITEM, not per order: one order can have items in
-- Pick List, Work Order, and Purchasing at the same time.

create extension if not exists pgcrypto; -- for gen_random_uuid()

create table public.orders (
  id          uuid primary key default gen_random_uuid(),
  order_no    text not null,
  customer    text not null,
  contact     text not null default '—',
  received_at timestamptz not null default now(),
  priority    text not null default 'Normal' check (priority in ('RUSH', 'High', 'Normal')),
  source      text not null default 'phone'  check (source in ('phone', 'Shopify')),
  will_call   boolean not null default false, -- intake intent (customer plans to pick up)
  -- Fulfillment outcome, set when a completed order is shipped or held for pickup.
  fulfillment          text check (fulfillment in ('willcall', 'shipping')),
  fulfillment_location text,            -- free text: where the order is staged in the warehouse (shelf, rack, counter)
  fulfilled_at         timestamptz,
  tracking_number      text,            -- shipping only: carrier tracking #, set when it goes out the door
  shipped_at           timestamptz,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create table public.items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  name           text not null,
  qty            integer not null default 1 check (qty > 0),
  dept           text not null default 'Machine' check (dept in ('Machine', 'Sewing')),
  color          text,
  -- new (needs triage) -> picklist | workorder | awaiting -> done
  stage          text not null default 'new'
                 check (stage in ('new', 'picklist', 'workorder', 'awaiting', 'done')),
  needs_material boolean not null default false,
  completed_by   text,             -- who finished it (filled on the work order sheet)
  position       integer not null default 0,
  created_at     timestamptz not null default now()
);

create table public.materials (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(id) on delete cascade,
  name       text not null,
  amount     text,            -- FREE TEXT: "20 ft", "2 sheets" — never a numeric stock count
  ordered    boolean not null default false,
  received   boolean not null default false,
  created_at timestamptz not null default now()
);

create index items_order_id_idx     on public.items(order_id);
create index materials_item_id_idx  on public.materials(item_id);
create index orders_received_at_idx on public.orders(received_at desc);

-- ============================================================
-- migrations/0002_functions.sql
-- ============================================================
-- Multi-step writes as atomic, concurrency-safe SQL functions. Running as
-- SECURITY INVOKER keeps row-level security in force (the caller must be an
-- authenticated office user). The client calls these via supabase.rpc().

-- Create an order and all its items in one transaction.
create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_order_id uuid;
  v_item     jsonb;
begin
  insert into public.orders (order_no, customer, contact, priority, source, will_call)
  values (
    p_order ->> 'order_no',
    p_order ->> 'customer',
    coalesce(nullif(p_order ->> 'contact', ''), '—'),
    coalesce(p_order ->> 'priority', 'Normal'),
    coalesce(p_order ->> 'source', 'phone'),
    coalesce((p_order ->> 'will_call')::boolean, false)
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.items (order_id, name, qty, dept, color, position)
    values (
      v_order_id,
      v_item ->> 'name',
      coalesce((v_item ->> 'qty')::int, 1),
      coalesce(v_item ->> 'dept', 'Machine'),
      nullif(v_item ->> 'color', ''),
      coalesce((v_item ->> 'position')::int, 0)
    );
  end loop;

  return v_order_id;
end;
$$;

-- Triage an item to "needs material": move it to `awaiting` and attach the
-- materials that Purchasing must buy.
create or replace function public.triage_need_material(p_item_id uuid, p_materials jsonb)
returns void
language plpgsql
security invoker
as $$
declare v_mat jsonb;
begin
  update public.items
    set stage = 'awaiting', needs_material = true
    where id = p_item_id;

  -- clean slate if the item is being re-triaged
  delete from public.materials where item_id = p_item_id;

  for v_mat in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  loop
    insert into public.materials (item_id, name, amount)
    values (p_item_id, v_mat ->> 'name', nullif(v_mat ->> 'amount', ''));
  end loop;
end;
$$;

-- Mark a material received ("have it"). If that was the last thing the item was
-- waiting on, advance it from `awaiting` into Work Order — atomically, so two
-- people clicking at once can't double-advance or leave it stuck.
create or replace function public.receive_material(p_material_id uuid)
returns void
language plpgsql
security invoker
as $$
declare v_item_id uuid;
begin
  update public.materials set received = true
    where id = p_material_id
    returning item_id into v_item_id;

  if v_item_id is null then
    return;
  end if;

  update public.items i
    set stage = 'workorder'
    where i.id = v_item_id
      and i.stage = 'awaiting'
      and not exists (
        select 1 from public.materials m
        where m.item_id = v_item_id and m.received = false
      );
end;
$$;

-- ============================================================
-- migrations/0003_rls.sql
-- ============================================================
-- Row-level security. This is an internal office tool: every authenticated
-- staff member can see and act on the whole board. Anonymous (logged-out)
-- requests get nothing. Finer-grained roles (coordinator / purchasing) can be
-- layered on later by tightening these policies.

alter table public.orders    enable row level security;
alter table public.items     enable row level security;
alter table public.materials enable row level security;

create policy "office full access" on public.orders
  for all to authenticated using (true) with check (true);

create policy "office full access" on public.items
  for all to authenticated using (true) with check (true);

create policy "office full access" on public.materials
  for all to authenticated using (true) with check (true);

-- ============================================================
-- migrations/0004_realtime.sql
-- ============================================================
-- Realtime: this is what makes the board update for everyone without a refresh.
-- Add the three tables to Supabase's realtime publication. Idempotent so the
-- migration is safe to re-run.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['orders', 'items', 'materials'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================
-- migrations/0005_work_orders.sql
-- ============================================================
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

-- ============================================================
-- seed.sql
-- ============================================================
-- Sample board for a fresh Supabase project — mirrors the prototype and the
-- app's local-mode seed. Runs only when the orders table is empty, so it's safe
-- to leave in place. `received_at` is relative to when you run it.

do $$
declare
  oid uuid;
  iid uuid;
begin
  if exists (select 1 from public.orders limit 1) then
    return; -- already seeded
  end if;

  -- #1051 — RUSH internal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1051', 'Floor — internal', 'Shop', now() - interval '18 minutes', 'RUSH') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Black rag 4x4', 6, 'Sewing', 'new', 0);

  -- #1050 — High, three items
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1050', 'Apex Rentals', 'Dave R.', now() - interval '125 minutes', 'High') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, '1/2" baby pin', 10, 'Machine', 'new', 0),
    (oid, 'Knuckle head, anodized', 4, 'Machine', 'new', 1),
    (oid, 'Sound blanket', 2, 'Sewing', 'new', 2);

  -- #1048 — Normal, mid-flight (one picking, one being made)
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1048', 'Lupe Films', 'Lupe', now() - interval '1500 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'C-stand arm', 8, 'Machine', 'picklist', 0),
    (oid, 'Grip head', 6, 'Machine', 'workorder', 1);
  update public.items set color = 'Black' where order_id = oid and name = 'Grip head';

  -- #1047 — Normal, waiting on material
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1047', 'Sunset Stages', 'Order desk', now() - interval '2900 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, color, stage, needs_material, position)
    values (oid, 'Cardellini-style clamp', 12, 'Machine', 'Black', 'awaiting', true, 0) returning id into iid;
  insert into public.materials (item_id, name, amount)
    values (iid, '1" aluminum bar', '20 ft');

  -- #1042 — Normal, done (ready to ship)
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1042', 'R. Mendez (DP)', 'Mendez', now() - interval '4300 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Mafer clamp', 5, 'Machine', 'done', 0);

  -- #1053 — RUSH
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1053', 'Indie DP — Sarah K.', 'Sarah K.', now() - interval '8 minutes', 'RUSH') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Cheese plate', 4, 'Machine', 'new', 0);

  -- #1052 — High
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1052', 'Griffith Park Studios', 'Tony', now() - interval '45 minutes', 'High') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'Junior pin', 20, 'Machine', 'new', 0),
    (oid, 'Baby plate', 10, 'Machine', 'new', 1);

  -- #1056 — High
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1056', 'Hand Held Films', 'Marco', now() - interval '95 minutes', 'High') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Turtle base', 2, 'Machine', 'new', 0);

  -- #1054 — Normal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1054', 'Keslow Camera', 'Front desk', now() - interval '210 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'Grid clamp', 16, 'Machine', 'new', 0),
    (oid, 'Sound blanket', 4, 'Sewing', 'new', 1);

  -- #1055 — Normal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1055', 'Quixote Studios', 'Purchasing', now() - interval '640 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'Offset arm', 8, 'Machine', 'new', 0),
    (oid, 'C-stand riser', 12, 'Machine', 'new', 1),
    (oid, 'Furni pad', 6, 'Sewing', 'new', 2);

  -- #1057 — Normal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1057', 'Sirui Rentals', 'Order desk', now() - interval '1320 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Empty sandbag (15 lb)', 50, 'Sewing', 'new', 0);

  -- #1058 — Normal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1058', 'Mole-Richardson', 'Shop', now() - interval '2100 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'Wall spreader', 6, 'Machine', 'new', 0),
    (oid, 'Scaffold clamp', 24, 'Machine', 'new', 1);
end $$;

