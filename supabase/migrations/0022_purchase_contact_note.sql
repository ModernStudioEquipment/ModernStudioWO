-- 0022: purchasing detail — who the buyer talked to at the vendor, and a
-- free-text note on a material (used for purchasing notes + the "we have X left,
-- need more because…" in-stock note). Also let create_purchase carry a note.

alter table public.materials add column if not exists contact text;
alter table public.materials add column if not exists note    text;

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
    insert into public.materials (item_id, name, amount, note)
    values (v_item_id, v_mat ->> 'name', nullif(v_mat ->> 'amount', ''), nullif(v_mat ->> 'note', ''));
  end loop;

  return v_order_id;
end;
$$;
