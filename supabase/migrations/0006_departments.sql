-- Expand item departments from {Machine, Sewing} to the four shop departments
-- {Shop, CNC, Sewing, Saw} — matching the custom work-order departments, and now
-- editable per item via a dropdown in the app. Run once on an existing project.
--
-- We DROP the old CHECK constraint and don't re-add a strict one: the app
-- enforces the four valid options via its dropdown. Dropping (rather than
-- swapping) the constraint means old and new app versions both keep working
-- during the deploy, with no breakage window.

alter table public.items drop constraint if exists items_dept_check;
update public.items set dept = 'Shop' where dept = 'Machine';
alter table public.items alter column dept set default 'Shop';

-- create_order default department -> 'Shop'
create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_order_id uuid;
  v_item     jsonb;
begin
  insert into public.orders (order_no, customer, contact, priority, source, will_call)
  values (
    p_order ->> 'order_no',
    p_order ->> 'customer',
    coalesce(nullif(p_order ->> 'contact', ''), '—'),
    coalesce(p_order ->> 'priority', 'Normal'),
    coalesce(p_order ->> 'source', 'phone'),
    coalesce((p_order ->> 'will_call')::boolean, false)
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.items (order_id, name, qty, dept, color, position)
    values (
      v_order_id,
      v_item ->> 'name',
      coalesce((v_item ->> 'qty')::int, 1),
      coalesce(v_item ->> 'dept', 'Shop'),
      nullif(v_item ->> 'color', ''),
      coalesce((v_item ->> 'position')::int, 0)
    );
  end loop;

  return v_order_id;
end;
$$;
