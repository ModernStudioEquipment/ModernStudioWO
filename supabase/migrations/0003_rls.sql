-- Row-level security. This is an internal office tool: every authenticated
-- staff member can see and act on the whole board. Anonymous (logged-out)
-- requests get nothing. Finer-grained roles (coordinator / purchasing) can be
-- layered on later by tightening these policies.

alter table public.orders    enable row level security;
alter table public.items     enable row level security;
alter table public.materials enable row level security;

create policy "office full access" on public.orders
  for all to authenticated using (true) with check (true);

create policy "office full access" on public.items
  for all to authenticated using (true) with check (true);

create policy "office full access" on public.materials
  for all to authenticated using (true) with check (true);
