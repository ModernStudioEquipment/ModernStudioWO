-- 0025: optional time on the due date. due_date stays a plain date (no timezone
-- surprises); due_time holds an optional "HH:MM" (24h), displayed local. Both
-- carried through create_order.

alter table public.orders add column if not exists due_time text;

create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_order_id uuid;
  v_item     jsonb;
begin
  insert into public.orders (order_no, customer, contact, priority, source, will_call, due_date, due_time, received_at, fulfillment_method)
  values (
    p_order ->> 'order_no',
    p_order ->> 'customer',
    coalesce(nullif(p_order ->> 'contact', ''), '—'),
    coalesce(p_order ->> 'priority', 'Normal'),
    coalesce(p_order ->> 'source', 'phone'),
    coalesce((p_order ->> 'will_call')::boolean, false),
    nullif(p_order ->> 'due_date', '')::date,
    nullif(p_order ->> 'due_time', ''),
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
