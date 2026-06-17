-- 0026: when a material is received in Purchasing, capture how many came in and
-- a note (separate from the purchasing note). The destination stage the item
-- moves to is chosen in the receive popup. Additive/safe.

alter table public.materials add column if not exists received_qty  text;
alter table public.materials add column if not exists received_note text;
