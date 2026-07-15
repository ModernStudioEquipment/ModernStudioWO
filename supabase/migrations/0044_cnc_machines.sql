-- 0044: CNC machine queues + library product/program numbers.
--
-- CNC now splits into three machines (Haas VF-4 / ST-10 / DS-30SSY). Adrian
-- assigns each CNC item to a machine as it lands; each machine has its own
-- drag-ordered queue. This stores the per-item machine assignment, plus adds
-- Product Number + CNC Program Number to the parts library.
--
-- Machine sub-queue ORDER reuses app_settings like the dept queues, with keys
-- floor_cnc_vf4 / floor_cnc_st10 / floor_cnc_ds30ssy (no schema needed).

-- Per-CNC-item machine assignment.
create table if not exists public.cnc_machine (
  item_id    uuid primary key references public.items(id) on delete cascade,
  machine    text check (machine in ('vf4', 'st10', 'ds30ssy')),
  updated_at timestamptz not null default now()
);

alter table public.cnc_machine enable row level security;
drop policy if exists cnc_machine_rw on public.cnc_machine;
create policy cnc_machine_rw on public.cnc_machine
  for all to authenticated using (true) with check (true);

-- Client-free view (for future per-machine wall monitors).
drop view if exists public.floor_cnc_machine;
create view public.floor_cnc_machine
  with (security_invoker = false, security_barrier = true) as
select item_id, machine from public.cnc_machine;
revoke all on public.floor_cnc_machine from public;
grant select on public.floor_cnc_machine to anon, authenticated;

-- Library: add Product Number + CNC Program Number, and surface them on the
-- client-free floor view.
alter table public.cnc_parts add column if not exists product_no text;
alter table public.cnc_parts add column if not exists program_no text;

drop view if exists public.floor_cnc_parts;
create view public.floor_cnc_parts
  with (security_invoker = false, security_barrier = true) as
select sku, name, steps, blueprint_url, material, notes, product_no, program_no
from public.cnc_parts;
revoke all on public.floor_cnc_parts from public;
grant select on public.floor_cnc_parts to anon, authenticated;
