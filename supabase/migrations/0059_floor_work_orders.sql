-- 0059: work orders you create reach the shop-floor monitors.
--
-- Reported: assigning a CNC work order to the DS-30SSY in Floor Control left the
-- DS-30SSY monitor saying "All caught up".
--
-- Two separate reasons, both here:
--
--   1. floor_queue is built from order ITEMS at the Work stage. A work order
--      raised on the Work Order tab isn't an item — it lives in work_orders with
--      its own type, title and form fields — so no such sheet could ever appear
--      on a wall monitor. Floor Control learned to read both (see FloorControl
--      collect()); the monitor reads this view, and until now the view didn't.
--
--   2. cnc_machine.item_id and floor_notes.item_id are foreign keys into items,
--      so assigning a machine to a work order (or typing it a floor note) failed
--      outright: the id is real, but it's a work_orders id.
--
-- PRIVACY. The floor may see the W/O number and what to make, and nothing else —
-- that rule is what the whole floor_* layer exists for (see 0038). A work order's
-- `fields` is one jsonb blob whose shape varies per department, and on some forms
-- it carries client-ish keys ("Ordered by", "Invoice(s)"). It is therefore NEVER
-- exposed wholesale: the select list below reads five keys out of it by name --
-- product, total/order, colour, part #, photo -- plus the due date. Anything not
-- named here cannot reach the floor. Do not add a key without asking what it can
-- contain on every one of the four forms.

-- ---------------------------------------------------------------------------
-- 1. Let the floor's two side tables hold a work order id.
--
--    Both were `references items(id) on delete cascade`. The cascade is the only
--    thing lost: a row here whose id no longer exists in either table is inert
--    (nothing joins to it, nothing reads it) and simply sits there.
-- ---------------------------------------------------------------------------
alter table public.cnc_machine drop constraint if exists cnc_machine_item_id_fkey;
alter table public.floor_notes drop constraint if exists floor_notes_item_id_fkey;

-- ---------------------------------------------------------------------------
-- 2. floor_queue: order items PLUS open custom work orders.
--
--    Ids stay uuid and stay unique — an items id and a work_orders id are both
--    random v4s — so the arrangement, machine and note maps keyed by id keep
--    working untouched for both kinds. `kind` says which table a row came from,
--    for anything that has to tell them apart.
-- ---------------------------------------------------------------------------
drop view if exists public.floor_queue;

create view public.floor_queue
  with (security_invoker = false, security_barrier = true) as
select
  i.id                                   as item_id,
  'item'::text                           as kind,
  o.order_no                             as order_no,
  i.dept                                 as dept,
  i.name                                 as product,
  i.qty                                  as qty,
  i.color                                as color,
  i.sku                                  as sku,
  i.image_url                            as image_url,
  i.stage                                as stage,
  i.in_progress                          as in_progress,
  (o.priority = 'RUSH')                  as is_rush,
  o.priority                             as priority,
  o.due_date                             as due_date,
  o.received_at                          as received_at,
  i.position                             as position
from public.items i
join public.orders o on o.id = i.order_id
where o.cancelled_at is null
  and i.stage = 'workorder'
  and i.dept in ('Shop', 'CNC', 'Sewing', 'Saw')

union all

select
  w.id                                   as item_id,
  'workorder'::text                      as kind,
  w.order_no                             as order_no,
  case w.type
    when 'cnc'    then 'CNC'
    when 'sewing' then 'Sewing'
    when 'saw'    then 'Saw'
    else               'Shop'
  end                                    as dept,
  -- What to make: the sheet's product, else its title (which the app derives
  -- from the first product line), else the number so a card is never nameless.
  coalesce(
    nullif(trim(w.fields ->> 'product'), ''),
    nullif(trim(w.title), ''),
    'Work order ' || coalesce(w.order_no, '')
  )                                      as product,
  -- How many. TEXT, like items.qty — quantities here are measured, not counted
  -- ("20 ft", "2 sheets"), which is why 0014 made that column free text, and a
  -- union has to agree. Whatever was typed on the sheet passes straight through.
  -- Line-item sheets (Sewing, Saw) have no total field: sum the quantity column
  -- of their rows instead, counting only rows with a plain number in it.
  coalesce(
    nullif(trim(w.fields ->> 'total'), ''),
    nullif(trim(w.fields ->> 'order'), ''),
    (
      select nullif(sum(
               case when l ->> 'qty' ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                    then trim(l ->> 'qty')::numeric end
             ), 0)::text
        from jsonb_array_elements(
               case when jsonb_typeof(w.fields -> 'lines') = 'array'
                    then w.fields -> 'lines' else '[]'::jsonb end
             ) as l
    )
  )                                      as qty,
  nullif(trim(w.fields ->> 'color'), '')  as color,
  -- The CNC part number doubles as the key into the parts library (steps and
  -- blueprint), exactly as an item's SKU does.
  nullif(trim(w.fields ->> 'partNo'), '') as sku,
  nullif(trim(w.fields ->> 'imageUrl'), '') as image_url,
  'workorder'::text                      as stage,
  false                                  as in_progress,
  false                                  as is_rush,
  'Normal'::text                         as priority,
  -- Sheet dates are typed as 09/16/2026. Only convert one that really looks like
  -- that; a date column is no place for whatever else someone typed.
  case
    when w.fields ->> 'dueDate' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
    then to_date(w.fields ->> 'dueDate', 'MM/DD/YYYY')
  end                                    as due_date,
  w.created_at                           as received_at,
  null::int                              as position
from public.work_orders w
where w.done = false
  and w.type in ('shop', 'cnc', 'sewing', 'saw');

comment on view public.floor_queue is
  'Client-free shop-floor queue: order items at the Work stage plus open custom '
  'work orders. Contains NO customer name/contact/ship-to/tracking/pricing/notes '
  '— only W/O#, dept, product, qty, colour, photo. Work-order fields are read key '
  'by key (product, total, order, color, partNo, imageUrl, dueDate) and the jsonb '
  'blob is never exposed: do not add a key without checking every form for what '
  'it can contain.';

revoke all on public.floor_queue from public;
grant select on public.floor_queue to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. "Done" from the monitor has to work for both kinds.
--
--    Same narrow contract as 0043: one id in, one row advanced, nothing else
--    readable or writable. An id that is neither a work-stage item nor an open
--    work order does nothing at all.
-- ---------------------------------------------------------------------------
create or replace function public.floor_complete_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.items
     set stage = 'done'
   where id = p_item_id
     and stage = 'workorder'
     and dept in ('Shop', 'CNC', 'Sewing', 'Saw');

  -- Not an item: the only other thing a floor card can be is a work order.
  if not found then
    update public.work_orders
       set done = true
     where id = p_item_id
       and done = false;
  end if;
end;
$$;

revoke all on function public.floor_complete_item(uuid) from public;
grant execute on function public.floor_complete_item(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (run in the SQL editor after applying)
--   -- the floor role sees work orders now, and still nothing it shouldn't:
--   set role anon;
--   select kind, count(*) from public.floor_queue group by kind;   -- both kinds
--   select customer from public.orders limit 1;   -- ERROR: permission denied
--   select fields  from public.work_orders limit 1; -- ERROR: permission denied
--   reset role;
-- ---------------------------------------------------------------------------
