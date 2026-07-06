-- 0043: Let the floor mark the current job done — the ONE thing the monitor can write.
--
-- The floor runs as `anon`, which by design can't touch any table. This adds a
-- single SECURITY DEFINER function that does exactly one narrow thing: advance
-- an item from the Work stage to done. It cannot read customer data, cannot
-- touch any other column, and cannot affect items in any other stage. `anon`
-- gets EXECUTE on just this function — nothing else changes.
--
-- Trade-off (accepted): the anon key is public, so in theory someone with it
-- could call this on a work-stage item id they somehow know. It's bounded to
-- workorder -> done on floor departments only (no client access, no other
-- stages), and the office sees every completion and can reopen it. Fine for an
-- internal shop tool; revisit if the floor ever needs to be locked tighter.
create or replace function public.floor_complete_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.items
     set stage = 'done'
   where id = p_item_id
     and stage = 'workorder'
     and dept in ('Shop', 'CNC', 'Sewing', 'Saw');
end;
$$;

revoke all on function public.floor_complete_item(uuid) from public;
grant execute on function public.floor_complete_item(uuid) to anon, authenticated;
