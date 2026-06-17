-- 0023: Will Call vs Shipping chosen at INTAKE so it sticks to the order
-- everywhere it travels. Separate from `fulfillment` (which is set at close-out),
-- so a pre-chosen method doesn't make the order look already fulfilled.
-- create_order carries the choice through.

alter table public.orders add column if not exists fulfillment_method text
  check (fulfillment_method in ('willcall', 'shipping'));

create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_order_id uuid;
  v_item     jsonb;
begin
  insert into public.orders (order_no, customer, contact, priority, source, will_call, due_date, received_at, fulfillment_method)
  values (
    p_order ->> 'order_no',
    p_order ->> 'customer',
    coalesce(nullif(p_order ->> 'contact', ''), '—'),
    coalesce(p_order ->> 'priority', 'Normal'),
    coalesce(p_order ->> 'source', 'phone'),
    coalesce((p_order ->> 'will_call')::boolean, false),
    nullif(p_order ->> 'due_date', '')::date,
    coalesce(nullif(p_order ->> 'received_at', '')::timestamptz, now()),
    nullif(p_order ->> 'fulfillment_method', '')
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.items (order_id, name, qty, dept, color, position, image_url, note)
    values (
      v_order_id,
      v_item ->> 'name',
      coalesce(nullif(v_item ->> 'qty', ''), '1'),
      coalesce(v_item ->> 'dept', 'Shop'),
      nullif(v_item ->> 'color', ''),
      coalesce((v_item ->> 'position')::int, 0),
      nullif(v_item ->> 'image_url', ''),
      nullif(v_item ->> 'note', '')
    );
  end loop;

  return v_order_id;
end;
$$;
