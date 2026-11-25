-- 0069: the CNC assistant's conversations and what it's been asked to remember.
--
-- Every question asked about a part (or about the shop, with no part) and every
-- answer, kept so the assistant can carry on where anyone left off, and so a
-- person can read back what was said. Photos sent with a question are links to
-- files already in storage.
--
--   role 'person'     a question, with who asked it and any photos
--   role 'assistant'  an answer
--   role 'memory'     a fact a person chose to keep ("Remember this"); sent with
--                     every question from then on. part_id null = the whole shop.
--
-- Office side only: nothing is granted to anon, as with the other CNC tables.
-- Safe to run more than once.

create table if not exists public.cnc_chat (
  id         uuid primary key default gen_random_uuid(),
  part_id    uuid references public.cnc_parts(id) on delete cascade,
  role       text not null check (role in ('person', 'assistant', 'memory')),
  body       text not null default '',
  photos     jsonb not null default '[]'::jsonb,
  author     text,
  meta       jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cnc_chat_part_idx on public.cnc_chat(part_id, created_at);
create index if not exists cnc_chat_memory_idx on public.cnc_chat(role) where role = 'memory';

alter table public.cnc_chat enable row level security;
drop policy if exists cnc_chat_rw on public.cnc_chat;
create policy cnc_chat_rw on public.cnc_chat
  for all to authenticated using (true) with check (true);
revoke all on public.cnc_chat from anon;
