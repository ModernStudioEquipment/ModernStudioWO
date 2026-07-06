-- 0040: Let the floor monitors honor the office-set queue order.
--
-- The office arranges each department's floor queue by dragging cards; that
-- ordering is saved in app_settings under keys floor_shop / floor_cnc /
-- floor_sewing / floor_saw, each a JSON array of item ids (the same mechanism
-- as the Orders-tab "orders_manual" order, migration 0035).
--
-- The floor connects as `anon`, which cannot read app_settings (authenticated-
-- only RLS). So we expose ONLY those four floor_* rows through a client-free
-- SECURITY DEFINER view. The values are arrays of item UUIDs + the key name --
-- no customer data. Additive and safe; touches no existing table or policy.
drop view if exists public.floor_arrangements;

create view public.floor_arrangements
  with (security_invoker = false, security_barrier = true) as
select key, value
from public.app_settings
where key in ('floor_shop', 'floor_cnc', 'floor_sewing', 'floor_saw');

comment on view public.floor_arrangements is
  'Office-set per-department floor queue order (arrays of item ids). Exposed to '
  'the anon floor role. No customer data.';

revoke all on public.floor_arrangements from public;
grant select on public.floor_arrangements to anon, authenticated;
