-- 0020: standalone "purchase" — material(s) to buy logged straight from the
-- Purchasing tab, with NO customer order. Stored as a lightweight order tagged
-- source='purchase' (the app keeps these out of the Orders list + dashboard)
-- whose single item is routed to Purchasing (awaiting material). First allow the
-- new source value, then create the helper that builds one in a transaction.

alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check
  check (source in ('phone', 'Shopify', 'QuickBooks', 'purchase'));

create or replace function public.create_purchase(p_order jsonb, p_materials jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_order_id uuid;
  v_item_id  uuid;
  v_mat      jsonb;
begin
  insert into public.orders (order_no, customer, contact, priority, source, will_call)
  values (p_order ->> 'order_no', 'Shop purchase', '—', 'Normal', 'purchase', false)
  returning id into v_order_id;

  insert into public.items (order_id, name, qty, dept, stage, needs_material, position)
  values (v_order_id, 'Shop purchase', '1', coalesce(p_order ->> 'dept', 'Shop'), 'awaiting', true, 0)
  returning id into v_item_id;

  for v_mat in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  loop
    insert into public.materials (item_id, name, amount)
    values (v_item_id, v_mat ->> 'name', nullif(v_mat ->> 'amount', ''));
  end loop;

  return v_order_id;
end;
$$;
