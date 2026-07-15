-- 0045: Expose the CNC per-machine queue order to the anon monitor.
--
-- Migration 0040 exposed only the four department arrangement keys. The CNC
-- machine sub-queues save under floor_cnc_vf4 / floor_cnc_st10 /
-- floor_cnc_ds30ssy, so widen the client-free view to every floor_* key (all
-- just arrays of item ids — no customer data). This lets the CNC monitor's
-- per-machine tabs honor the order Adrian set.
drop view if exists public.floor_arrangements;

create view public.floor_arrangements
  with (security_invoker = false, security_barrier = true) as
select key, value
from public.app_settings
where key like 'floor\_%' escape '\';

comment on view public.floor_arrangements is
  'Office-set floor queue order (dept + CNC machine sub-queues). Arrays of item '
  'ids only, no customer data. Exposed to the anon floor role.';

revoke all on public.floor_arrangements from public;
grant select on public.floor_arrangements to anon, authenticated;
