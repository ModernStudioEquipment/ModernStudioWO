-- 0068: everything a programmer needs, kept on the part (CNC Catalog).
--
-- The CNC programs lived only on the Haas machines, and the facts needed to fix
-- them (what's finished by hand, how a part is held, which tool is in which
-- pocket) lived in people's heads. This gives them a home:
--
--   cnc_parts.facts     what isn't in any file: stock size, hand finishing,
--                       how it's held, known problems, quantity per run
--   cnc_programs        the program files themselves, every version kept, each
--                       stamped proven or not (and by whom)
--   cnc_machine_facts   per machine: the real tool list, workholding, notes
--
-- Office side only. Nothing here is granted to anon and the wall monitors'
-- floor_cnc_parts view is left exactly as it is.
--
-- Safe to run more than once.

alter table public.cnc_parts add column if not exists facts jsonb not null default '{}'::jsonb;

create table if not exists public.cnc_programs (
  id         uuid primary key default gen_random_uuid(),
  part_id    uuid not null references public.cnc_parts(id) on delete cascade,
  name       text not null default '',
  content    text not null default '',
  status     text not null default 'unproven' check (status in ('unproven', 'proven')),
  proven_by  text,
  proven_at  timestamptz,
  note       text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cnc_programs_part_idx on public.cnc_programs(part_id, created_at desc);

alter table public.cnc_programs enable row level security;
drop policy if exists cnc_programs_rw on public.cnc_programs;
create policy cnc_programs_rw on public.cnc_programs
  for all to authenticated using (true) with check (true);
revoke all on public.cnc_programs from anon;

create table if not exists public.cnc_machine_facts (
  machine    text primary key,
  facts      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.cnc_machine_facts enable row level security;
drop policy if exists cnc_machine_facts_rw on public.cnc_machine_facts;
create policy cnc_machine_facts_rw on public.cnc_machine_facts
  for all to authenticated using (true) with check (true);
revoke all on public.cnc_machine_facts from anon;
