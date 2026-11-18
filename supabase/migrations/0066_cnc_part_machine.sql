-- 0066: which CNC machine(s) make each catalogue part.
--
-- Machine keys (vf4, st10, ds30ssy), comma separated when a part runs on more
-- than one. Office side only: the wall monitors' floor_cnc_parts view is left
-- as it is, so nothing new reaches the anon key.
--
-- Safe to run more than once.

alter table public.cnc_parts add column if not exists machine text;
