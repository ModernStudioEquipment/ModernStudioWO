-- 0008: per-item product photo (image_url). Auto-filled from Shopify for new
-- orders when a read_products Admin token is configured, and/or set manually in
-- the app. Additive/safe. Self-contained: also ensures the due_date column from
-- 0007 exists, and recreates create_order to carry both fields — so running this
-- alone brings the schema fully up to date even if 0007 wasn't run.

alter table public.items  add column if not exists image_url text;
alter table public.orders add column if not exists due_date  date;

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
    insert into public.items (order_id, name, qty, dept, color, position, image_url)
    values (
      v_order_id,
      v_item ->> 'name',
      coalesce((v_item ->> 'qty')::int, 1),
      coalesce(v_item ->> 'dept', 'Shop'),
      nullif(v_item ->> 'color', ''),
      coalesce((v_item ->> 'position')::int, 0),
      nullif(v_item ->> 'image_url', '')
    );
  end loop;

  return v_order_id;
end;
$$;
