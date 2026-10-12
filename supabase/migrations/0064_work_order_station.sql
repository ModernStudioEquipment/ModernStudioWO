-- Which bench, machine or person makes this work order.
--
-- The office asked for the department dropdown to say "Sewing 2" rather than
-- just "Sewing": there are several sewers and several shop benches, and a sheet
-- that only says "Sewing" doesn't tell anyone which one of them it is for.
--
-- This is deliberately NOT a new `type`. `type` is checked against the four
-- departments and each one draws a DIFFERENT printed sheet, so a fifth value
-- would mean a fifth form. The station rides alongside the department instead:
-- type stays 'sewing', station holds '2' (or 'Maria', if they'd rather name the
-- person). Null means what it has always meant — the department, unassigned.
--
-- Free text on purpose. Nobody knows yet whether these end up as bench numbers
-- or people's names, and a check constraint guessing wrong would mean another
-- migration to undo.
alter table public.work_orders
  add column if not exists station text;

comment on column public.work_orders.station is
  'Bench / machine / person within the department, e.g. 2 or Maria. Null = unassigned.';
