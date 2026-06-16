-- 0014: allow free-text quantities (e.g. "5 ft", "10 in", "2 sheets") since some
-- products are measured, not counted. Change items.qty from integer to text and
-- drop the numeric check. Existing integer values are preserved as their text
-- form ("5" stays "5"). Additive in spirit — text holds any old value.

alter table public.items alter column qty drop default;
alter table public.items drop constraint if exists items_qty_check;
alter table public.items alter column qty type text using qty::text;
alter table public.items alter column qty set default '1';
