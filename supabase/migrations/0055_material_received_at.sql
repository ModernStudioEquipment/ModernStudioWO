-- 0055: when a material was received.
--
-- Purchasing only lists orders that are still WAITING on something, so the
-- moment the last material lands the whole thing drops off the tab. Whoever
-- runs purchasing then has no way to see what came in or where it went — the
-- product is somewhere on the board, but which tab is anyone's guess.
--
-- The Received section needs an ordering to be useful ("what came in today"),
-- and `received` on its own is just a boolean. Mirrors ordered_at.
alter table public.materials add column if not exists received_at timestamptz;

comment on column public.materials.received_at is
  'When this material was marked received. Drives the Received list in Purchasing.';

-- Backfill so existing received materials aren't stranded with no date and
-- sorted last forever. The order's own date is the closest honest approximation
-- available — it is certainly not later than the receipt.
update public.materials m
   set received_at = o.received_at
  from public.items i
  join public.orders o on o.id = i.order_id
 where m.item_id = i.id
   and m.received
   and m.received_at is null;
