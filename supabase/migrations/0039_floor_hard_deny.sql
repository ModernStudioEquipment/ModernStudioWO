-- 0039: Harden the shop-floor wall to a HARD DENY.
--
-- The floor app connects as `anon`. Today anon already sees zero client rows,
-- but only because RLS (0003) has no anon policy and filters every row out --
-- anon still holds Supabase's DEFAULT table grant. That's a single layer: a
-- stray permissive anon policy added later would leak. This migration removes
-- anon's base-table privileges on the client-bearing tables, turning the silent
-- RLS row-filter into a hard "permission denied for table ...".
--
-- Why this is safe:
--   * The floor's views (floor_queue, floor_item_photos, migration 0038) are
--     SECURITY DEFINER -- they read the base tables as their OWNER, not as anon,
--     so revoking anon here does NOT affect them. The floor keeps working.
--   * Only `anon` is touched. The office app runs as `authenticated`, which
--     keeps its own grants + the "office full access" RLS policies. Untouched.
--
-- Additive and reversible (re-grant to restore). Safe to run on the live DB.

revoke all on public.orders      from anon;
revoke all on public.items       from anon;
revoke all on public.materials   from anon;
revoke all on public.work_orders from anon;

-- ---------------------------------------------------------------------------
-- VERIFY (run after applying): each of these must now ERROR, not return 0 rows.
--   set role anon;
--   select customer from public.orders limit 1;   -- ERROR: permission denied for table orders
--   select * from public.items  limit 1;          -- ERROR: permission denied for table items
--   select order_no, dept, product, qty from public.floor_queue limit 5;  -- still OK
--   reset role;
-- ---------------------------------------------------------------------------
