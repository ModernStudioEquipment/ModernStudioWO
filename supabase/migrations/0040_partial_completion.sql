-- 0040: route partial-pickup completion correctly.
--
-- record_fulfillment used to set only picked_up_at / shipped_at when an order
-- became fully out. That worked when the order was already on a fulfillment tab
-- (fulfillment set + items done), but the order-detail "Picked up partial" button
-- can finish an order that was never routed there — leaving picked_up_at set but
-- fulfillment = null and items still in their stage, so it got STUCK instead of
-- moving to Completed. Now, on completion we also set the order's fulfillment
-- (willcall/shipping) and mark every item done, so it lands in Completed no matter
-- where the pickup was recorded from. This is a no-op for orders already routed +
-- done, so the existing Will Call / Shipping flows are unchanged.

create or replace function public.record_fulfillment(
  p_order_id uuid, p_kind text, p_person text, p_carrier text, p_tracking text, p_note text, p_lines jsonb
) returns void language plpgsql security invoker as $$
declare v_line jsonb; v_all_out boolean;
begin
  insert into public.fulfillments (order_id, kind, person, carrier, tracking_number, note, lines)
  values (p_order_id, p_kind, nullif(p_person, ''), nullif(p_carrier, ''), nullif(p_tracking, ''), nullif(p_note, ''), coalesce(p_lines, '[]'::jsonb));

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    update public.items
      set fulfilled_qty = fulfilled_qty + coalesce((v_line ->> 'qty')::int, 0)
      where id = (v_line ->> 'itemId')::uuid;
  end loop;

  select bool_and(fulfilled_qty >= greatest(coalesce(nullif(regexp_replace(qty, '[^0-9].*$', '', 'g'), '')::int, 1), 1))
    into v_all_out from public.items where order_id = p_order_id;

  if v_all_out then
    -- route it to Completed even if the pickup was recorded from the order view
    update public.items set stage = 'done' where order_id = p_order_id and stage <> 'done';
    if p_kind = 'pickup' then
      update public.orders
        set picked_up_at = now(), picked_up_by = nullif(p_person, ''),
            fulfillment = 'willcall', fulfilled_at = coalesce(fulfilled_at, now())
        where id = p_order_id;
    else
      update public.orders
        set tracking_number = coalesce(nullif(p_tracking, ''), tracking_number, 'shipped'), shipped_at = now(),
            fulfillment = 'shipping', fulfilled_at = coalesce(fulfilled_at, now())
        where id = p_order_id;
    end if;
  end if;
end;
$$;
