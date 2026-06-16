-- 0018: let create_order carry an explicit received_at (the order's intake date).
-- The QuickBooks sync uses this so each board order shows the invoice's real date
-- instead of the moment it was synced. When not provided (manual orders, Shopify
-- webhook) it falls back to now(), so existing callers are unaffected.
-- Otherwise identical to 0016 (qty stays text, optional per-item note).

create or replace function public.create_order(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_order_id uuid;
  v_item     jsonb;
begin
  insert into public.orders (order_no, customer, contact, priority, source, will_call, due_date, received_at)
  values (
    p_order ->> 'order_no',
    p_order ->> 'customer',
    coalesce(nullif(p_order ->> 'contact', ''), '—'),
    coalesce(p_order ->> 'priority', 'Normal'),
    coalesce(p_order ->> 'source', 'phone'),
    coalesce((p_order ->> 'will_call')::boolean, false),
    nullif(p_order ->> 'due_date', '')::date,
    coalesce(nullif(p_order ->> 'received_at', '')::timestamptz, now())
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
