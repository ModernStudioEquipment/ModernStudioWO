-- 0016: fix create_order after qty became free text, and let it carry a
-- per-item note. The 0008 version still cast qty to ::int, which breaks every
-- insert now that items.qty is text (Shopify webhook, manual orders, QuickBooks
-- sync). This recreates create_order to store qty as text and accept an optional
-- note (used to stash the QuickBooks line description so it shows in the item
-- pop-up). Also re-asserts qty as text so this migration is safe to run alone.

alter table public.items alter column qty drop default;
alter table public.items alter column qty type text using qty::text;
alter table public.items alter column qty set default '1';

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
