-- 0027: mark a purchase as "for an order" (more urgent) vs "inventory/restock".
-- false = for an order (the default — triaged-from-order materials are for an
-- order). create_purchase carries the choice for standalone purchases.

alter table public.materials add column if not exists for_inventory boolean not null default false;

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
    insert into public.materials (item_id, name, amount, note, for_inventory)
    values (v_item_id, v_mat ->> 'name', nullif(v_mat ->> 'amount', ''), nullif(v_mat ->> 'note', ''), coalesce((v_mat ->> 'for_inventory')::boolean, false));
  end loop;

  return v_order_id;
end;
$$;
