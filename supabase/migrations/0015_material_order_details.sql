-- 0015: when a material is marked ordered in Purchasing, capture who ordered it,
-- which vendor it was ordered from, and the PO number. Additive/safe.

alter table public.materials add column if not exists ordered_by text;
alter table public.materials add column if not exists vendor   text;
alter table public.materials add column if not exists po_number text;
