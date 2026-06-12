-- 0007: optional per-order due date — powers the new-order form's "Due date"
-- field and the "Due date" sort in the Orders tab.
--
-- Additive and backward-compatible: the column is nullable and old app versions
-- simply ignore it, so this is safe to run before deploying the new front end.

alter table public.orders add column if not exists due_date date;

-- Recreate create_order so it accepts an optional due_date in p_order. Mirrors
-- the 0006 version (dept defaults to 'Shop'), just with due_date added.
create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_order_id uuid;
  v_item     jsonb;
begin
  insert into public.orders (order_no, customer, contact, priority, source, will_call, due_date)
  values (
    p_order ->> 'order_no',
    p_order ->> 'customer',
    coalesce(nullif(p_order ->> 'contact', ''), '—'),
    coalesce(p_order ->> 'priority', 'Normal'),
    coalesce(p_order ->> 'source', 'phone'),
    coalesce((p_order ->> 'will_call')::boolean, false),
    nullif(p_order ->> 'due_date', '')::date
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
