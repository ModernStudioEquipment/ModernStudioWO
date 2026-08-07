-- An in-between state for Purchasing.
--
-- A material was binary: not ordered -> ordered. So anything a buyer was actively
-- working on (waiting on a vendor quote, chasing approval) looked identical to
-- something nobody had touched — and a second person could start the same chase.
--
-- progress is free text so the wording can change without a migration; the app
-- offers a short preset list. Cleared automatically when the material is ordered.
-- progress_at is the immutable "when it was flagged" stamp.
alter table public.materials add column if not exists progress    text;
alter table public.materials add column if not exists progress_at timestamptz;
alter table public.materials add column if not exists progress_by text;
