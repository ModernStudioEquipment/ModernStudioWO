-- 0029: partial pickups + partial shipments. Each item tracks how many have gone
-- out (fulfilled_qty); every pickup/shipment is logged in `fulfillments` so you
-- can see it went out over multiple visits, with who/qty each time. The order
-- stays live until every item is fully out, then it's marked complete (picked up
-- / shipped) and moves to Completed.

alter table public.items add column if not exists fulfilled_qty integer not null default 0;

create table if not exists public.fulfillments (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  kind            text not null check (kind in ('pickup', 'shipment')),
  person          text,          -- who collected it (pickups)
  carrier         text,          -- shipments
  tracking_number text,          -- shipments
  note            text,
  lines           jsonb not null default '[]'::jsonb,  -- [{ itemId, name, qty }]
  created_at      timestamptz not null default now()
);
alter table public.fulfillments enable row level security;
drop policy if exists fulfillments_all on public.fulfillments;
create policy fulfillments_all on public.fulfillments for all to authenticated using (true) with check (true);
create index if not exists fulfillments_order_idx on public.fulfillments(order_id);

-- Record one pickup/shipment: log it, add the quantities to each item, and if the
-- whole order is now out, mark it complete. The ordered qty can be free text
-- ("20 ft") — we use its leading number, treating non-numeric as 1.
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
    if p_kind = 'pickup' then
      update public.orders set picked_up_at = now(), picked_up_by = nullif(p_person, '') where id = p_order_id;
    else
      update public.orders set tracking_number = coalesce(nullif(p_tracking, ''), tracking_number, 'shipped'), shipped_at = now() where id = p_order_id;
    end if;
  end if;
end;
$$;
