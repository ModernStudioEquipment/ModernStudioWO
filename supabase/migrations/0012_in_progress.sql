-- 0012: per-item "in progress" flag for the Work Order tab. Lets the shop mark
-- an item as actively being worked on (distinct from done). Additive/safe.

alter table public.items add column if not exists in_progress boolean not null default false;
