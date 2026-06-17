-- 0019: capture the order date and expected-arrival date when a material is
-- marked ordered in Purchasing. The expected date drives an "arriving" flag on
-- the board once it's reached. Additive/safe — runs alongside 0015's vendor/PO.

alter table public.materials add column if not exists ordered_at  date;
alter table public.materials add column if not exists expected_at date;
