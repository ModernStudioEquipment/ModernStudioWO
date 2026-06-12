-- Multi-step writes as atomic, concurrency-safe SQL functions. Running as
-- SECURITY INVOKER keeps row-level security in force (the caller must be an
-- authenticated office user). The client calls these via supabase.rpc().

-- Create an order and all its items in one transaction.
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
      coalesce(v_item ->> 'dept', 'Machine'),
      nullif(v_item ->> 'color', ''),
      coalesce((v_item ->> 'position')::int, 0)
    );
  end loop;

  return v_order_id;
end;
$$;

-- Triage an item to "needs material": move it to `awaiting` and attach the
-- materials that Purchasing must buy.
create or replace function public.triage_need_material(p_item_id uuid, p_materials jsonb)
returns void
language plpgsql
security invoker
as $$
declare v_mat jsonb;
begin
  update public.items
    set stage = 'awaiting', needs_material = true
    where id = p_item_id;

  -- clean slate if the item is being re-triaged
  delete from public.materials where item_id = p_item_id;

  for v_mat in select * from jsonb_array_elements(coalesce(p_materials, '[]'::jsonb))
  loop
    insert into public.materials (item_id, name, amount)
    values (p_item_id, v_mat ->> 'name', nullif(v_mat ->> 'amount', ''));
  end loop;
end;
$$;

-- Mark a material received ("have it"). If that was the last thing the item was
-- waiting on, advance it from `awaiting` into Work Order — atomically, so two
-- people clicking at once can't double-advance or leave it stuck.
create or replace function public.receive_material(p_material_id uuid)
returns void
language plpgsql
security invoker
as $$
declare v_item_id uuid;
begin
  update public.materials set received = true
    where id = p_material_id
    returning item_id into v_item_id;

  if v_item_id is null then
    return;
  end if;

  update public.items i
    set stage = 'workorder'
    where i.id = v_item_id
      and i.stage = 'awaiting'
      and not exists (
        select 1 from public.materials m
        where m.item_id = v_item_id and m.received = false
      );
end;
$$;
