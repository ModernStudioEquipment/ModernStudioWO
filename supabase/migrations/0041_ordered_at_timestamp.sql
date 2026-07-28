-- 0041: the "ordered" stamp becomes a full, immutable timestamp.
-- Before this, materials.ordered_at was a user-editable DATE (a picker that
-- defaulted to today and could be backdated). Per the immutable-stamp rule,
-- marking a material ordered now auto-records the exact moment (date + time) at
-- the instant of the action, and it is never adjustable. Widen the column from
-- `date` to `timestamptz` so it can carry the time. Existing date values convert
-- to that day at local midnight.
alter table public.materials
  alter column ordered_at type timestamptz using ordered_at::timestamptz;
