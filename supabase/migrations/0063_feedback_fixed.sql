-- 0063: record what was done about a report, so the person who filed it can be
-- told.
--
-- Someone reports a thing, hears nothing back, and stops reporting things. The
-- button only keeps working if using it visibly leads somewhere.

alter table public.app_feedback add column if not exists fixed_note text;        -- what was done, in plain words
alter table public.app_feedback add column if not exists fixed_at   timestamptz; -- when it was closed
alter table public.app_feedback add column if not exists fixed_by   text;        -- who closed it

-- No policy changes: the fix is written server-side with the service key, from
-- the signed link in the notification email. Staff still read the table.

-- ---------------------------------------------------------------------------
-- WHAT'S OPEN (run in the SQL editor any time)
--   select created_at, kind, urgent, author, body
--     from public.app_feedback where fixed_at is null
--    order by urgent desc, created_at;
-- ---------------------------------------------------------------------------
