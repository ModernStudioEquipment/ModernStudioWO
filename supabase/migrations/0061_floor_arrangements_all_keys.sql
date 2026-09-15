-- 0061: let the monitors see the CNC per-machine queue order.
--
-- Reported: reordering a queue in Floor Control doesn't change the live monitor.
--
-- Measured on the live CNC monitor before writing this: it had a department
-- arrangement of 6 ids and machine arrangements of {vf4: 0, st10: 0, ds30ssy: 0}
-- — empty for every machine, whatever the office had set.
--
-- Because floor_arrangements in production is still the 0040 version, which
-- names four keys:
--
--     where key in ('floor_shop', 'floor_cnc', 'floor_sewing', 'floor_saw')
--
-- The CNC machine sub-queues save under floor_cnc_vf4 / floor_cnc_st10 /
-- floor_cnc_ds30ssy. The office wrote them, the view filtered them out, and the
-- monitor fell back to rush-then-oldest — silently, because from the office side
-- the drag saved perfectly well.
--
-- 0045 already widened this view; it evidently never reached production. This is
-- that same change, standalone and safe to run whether or not 0045 ever ran.
-- Nothing else is touched.
--
-- Values are arrays of ids and nothing else — no customer data — which is why
-- every floor_* key is safe to expose rather than an enumerated four.
drop view if exists public.floor_arrangements;

create view public.floor_arrangements
  with (security_invoker = false, security_barrier = true) as
select key, value
from public.app_settings
where key like 'floor\_%' escape '\';

comment on view public.floor_arrangements is
  'Office-set floor queue order (department queues + the CNC machine sub-queues). '
  'Arrays of ids only, no customer data. Exposed to the anon floor role.';

revoke all on public.floor_arrangements from public;
grant select on public.floor_arrangements to anon, authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (run in the SQL editor after applying)
--   -- every queue the office has arranged, as the floor now sees it:
--   set role anon;
--   select key, jsonb_array_length(value) as jobs
--     from public.floor_arrangements order by key;
--   reset role;
--
--   Expect floor_cnc_vf4 / floor_cnc_st10 / floor_cnc_ds30ssy to appear here for
--   any machine lane that has been dragged. If a lane you've ordered is missing,
--   the order was never saved — that's a different problem, and Floor Control
--   now says so on screen when it happens.
-- ---------------------------------------------------------------------------
