-- 0011: free-text note per item. Shown in the Pick List item pop-up (read/write)
-- with a bell indicator on any item that has one. Additive/safe.

alter table public.items add column if not exists note text;
