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
