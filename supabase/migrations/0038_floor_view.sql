-- 0038: Shop-floor display privacy layer.
--
-- The floor monitors (Shop / CNC / Sewing / Saw) run a SEPARATE app pointed at
-- this same database. The hard rule: the floor may see ONLY the work-order
-- number + what to make (dept, product, qty, color, product photo). It must
-- NEVER be able to reach customer name, contact, ship-to, ship-via, tracking,
-- fulfillment, pricing, or any note free-text that could name a client.
--
-- HOW THE WALL WORKS
-- The floor app connects as the `anon` role (no login). The office boards run as
-- `authenticated`, and the base tables' RLS (migration 0003) grants full access
-- ONLY to `authenticated`, denying `anon` outright. So the floor already cannot
-- read orders/items/materials at all. We then expose ONE narrow, client-free
-- SECURITY DEFINER view and grant SELECT on it to `anon`. The view runs with the
-- owner's rights (bypassing RLS) but returns ONLY the whitelisted columns below —
-- there is physically no path from the floor to a client column.
--
-- This migration is PURELY ADDITIVE. It creates two views + grants. It does not
-- alter any existing table, policy, or office behavior, so it is safe to run on
-- the live database with the office app untouched.

-- ---------------------------------------------------------------------------
-- 1. The floor queue: what each department needs to build, and nothing else.
--    Gating is BY STAGE: an item appears once it has been triaged to a floor
--    department and routed to the Work stage (stage = 'workorder'). Cancelled
--    orders are excluded. No client columns are selected — the wall is the
--    SELECT list itself.
-- ---------------------------------------------------------------------------
drop view if exists public.floor_queue;

create view public.floor_queue
  with (security_invoker = false, security_barrier = true) as
select
  i.id                                   as item_id,     -- stable key for React + realtime
  o.order_no                             as order_no,    -- the WO# shown on the card
  i.dept                                 as dept,        -- Shop | CNC | Sewing | Saw
  i.name                                 as product,     -- what to make
  i.qty                                  as qty,         -- free-text quantity
  i.color                                as color,       -- product color, if any
  i.sku                                  as sku,         -- key into floor_item_photos
  i.image_url                            as image_url,   -- Shopify per-item product photo
  i.stage                                as stage,
  i.in_progress                          as in_progress, -- someone is actively on it
  (o.priority = 'RUSH')                  as is_rush,     -- urgency flag (not client data)
  o.priority                             as priority,    -- RUSH | High | Normal
  o.due_date                             as due_date,
  o.received_at                          as received_at, -- for FIFO ordering only
  i.position                             as position     -- office-set manual order
from public.items i
join public.orders o on o.id = i.order_id
where o.cancelled_at is null
  and i.stage = 'workorder'
  and i.dept in ('Shop', 'CNC', 'Sewing', 'Saw');

comment on view public.floor_queue is
  'Client-free shop-floor queue. Exposed to the anon (floor) role. Contains NO '
  'customer name/contact/ship-to/tracking/pricing/notes — only WO#, dept, '
  'product, qty, color, photo. Do not add client columns to this SELECT list.';

-- ---------------------------------------------------------------------------
-- 2. Product photos the floor may show. item_photos is keyed by SKU and holds
--    only product imagery (no client data), but its own RLS is authenticated-
--    only, so we surface a definer view of just (sku, image_url) to the floor.
-- ---------------------------------------------------------------------------
drop view if exists public.floor_item_photos;

create view public.floor_item_photos
  with (security_invoker = false, security_barrier = true) as
select sku, image_url
from public.item_photos;

comment on view public.floor_item_photos is
  'SKU -> product photo for the floor display. No client data.';

-- ---------------------------------------------------------------------------
-- 3. Grants. Lock the views down, then hand SELECT to the floor (anon) and to
--    the office (authenticated, for the reorder preview). Nothing gets INSERT/
--    UPDATE/DELETE — the floor is read-only by construction.
-- ---------------------------------------------------------------------------
revoke all on public.floor_queue       from public;
revoke all on public.floor_item_photos from public;

grant select on public.floor_queue       to anon, authenticated;
grant select on public.floor_item_photos to anon, authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY THE WALL (run in the SQL editor after applying)
--   -- floor role can read the queue but NOT the base tables:
--   set role anon;
--   select count(*) from public.floor_queue;      -- OK (rows)
--   select customer from public.orders limit 1;    -- ERROR: permission denied
--   select * from public.items limit 1;            -- ERROR: permission denied
--   reset role;
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- DEFERRED (needs a field-key whitelist before it can be exposed):
--   CNC blueprints / step instructions live in work_orders.fields (jsonb). That
--   jsonb also carries client-ish keys on some forms (e.g. Sewing's "Ordered By"
--   / "Invoice(s)"), so it CANNOT be exposed wholesale. When we wire CNC steps
--   to the floor, add a view that pulls ONLY the whitelisted keys (steps, part #,
--   cut lines) per form type -- never the raw fields blob.
-- ---------------------------------------------------------------------------
