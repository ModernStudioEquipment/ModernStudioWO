-- Keep "how much we need" and "how much we actually bought" apart.
--
-- materials.amount is the REQUESTED quantity — what the order needs, set when the
-- material is raised. Marking it ordered used to write the ordered quantity back
-- over that same column, so the original request was destroyed and there was no
-- way to see that we asked for 20ft and only got 12ft.
--
-- ordered_qty holds what was actually ordered. Free text like amount ("20 ft",
-- "2 sheets", "12") — the shop doesn't track numeric stock.
alter table public.materials add column if not exists ordered_qty text;
