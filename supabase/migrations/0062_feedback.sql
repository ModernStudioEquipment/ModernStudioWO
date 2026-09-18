-- 0062: a way for the shop to say something's wrong, or that they've thought of
-- something better.
--
-- Thirty-odd people use this board all day and every report of a problem has so
-- far arrived by being told in person, which means it arrives only if someone
-- happens to be standing there — and arrives without the one thing that makes it
-- fixable: what they were doing at the time.
--
-- One row per report. `context` is what the app knew when the button was pressed
-- (which tab, screen size, phone or desktop) so nobody has to describe their own
-- setup. It's set by the app, never typed.

create table if not exists public.app_feedback (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'problem' check (kind in ('problem', 'idea')),
  body       text not null,
  urgent     boolean not null default false,  -- "this is stopping me working"
  where_at   text,                        -- unused; the app records the tab itself
  author     text,                        -- who wrote it, from the login
  author_id  uuid default auth.uid(),
  context    jsonb not null default '{}'::jsonb,
  status     text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at timestamptz not null default now()
);

-- Safe to re-run over a table created before `urgent` existed.
alter table public.app_feedback add column if not exists urgent boolean not null default false;

create index if not exists app_feedback_created_idx on public.app_feedback(created_at desc);

alter table public.app_feedback enable row level security;

do $$
begin
  -- Anyone signed in can file one, and can read what's been filed. Deliberate:
  -- seeing that someone already reported a thing is what stops the same report
  -- arriving nine times, and there is nothing private in here.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_feedback' and policyname='feedback insertable') then
    create policy "feedback insertable" on public.app_feedback for insert to authenticated with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_feedback' and policyname='feedback readable') then
    create policy "feedback readable" on public.app_feedback for select to authenticated using (true);
  end if;
  -- Status is the only thing that changes after the fact (new -> seen -> done).
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_feedback' and policyname='feedback status updatable') then
    create policy "feedback status updatable" on public.app_feedback for update to authenticated using (true) with check (true);
  end if;
  -- No delete policy: a complaint about the app can't be made to disappear from
  -- inside the app.
end $$;

-- ---------------------------------------------------------------------------
-- READ IT (run in the SQL editor any time)
--   select created_at, kind, urgent, author, body
--     from public.app_feedback
--    where status = 'new'
--    order by created_at desc;
-- ---------------------------------------------------------------------------
