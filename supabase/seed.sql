-- Sample board for a fresh Supabase project — mirrors the prototype and the
-- app's local-mode seed. Runs only when the orders table is empty, so it's safe
-- to leave in place. `received_at` is relative to when you run it.

do $$
declare
  oid uuid;
  iid uuid;
begin
  if exists (select 1 from public.orders limit 1) then
    return; -- already seeded
  end if;

  -- #1051 — RUSH internal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1051', 'Floor — internal', 'Shop', now() - interval '18 minutes', 'RUSH') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Black rag 4x4', 6, 'Sewing', 'new', 0);

  -- #1050 — High, three items
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1050', 'Apex Rentals', 'Dave R.', now() - interval '125 minutes', 'High') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, '1/2" baby pin', 10, 'Machine', 'new', 0),
    (oid, 'Knuckle head, anodized', 4, 'Machine', 'new', 1),
    (oid, 'Sound blanket', 2, 'Sewing', 'new', 2);

  -- #1048 — Normal, mid-flight (one picking, one being made)
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1048', 'Lupe Films', 'Lupe', now() - interval '1500 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'C-stand arm', 8, 'Machine', 'picklist', 0),
    (oid, 'Grip head', 6, 'Machine', 'workorder', 1);
  update public.items set color = 'Black' where order_id = oid and name = 'Grip head';

  -- #1047 — Normal, waiting on material
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1047', 'Sunset Stages', 'Order desk', now() - interval '2900 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, color, stage, needs_material, position)
    values (oid, 'Cardellini-style clamp', 12, 'Machine', 'Black', 'awaiting', true, 0) returning id into iid;
  insert into public.materials (item_id, name, amount)
    values (iid, '1" aluminum bar', '20 ft');

  -- #1042 — Normal, done (ready to ship)
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1042', 'R. Mendez (DP)', 'Mendez', now() - interval '4300 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Mafer clamp', 5, 'Machine', 'done', 0);

  -- #1053 — RUSH
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1053', 'Indie DP — Sarah K.', 'Sarah K.', now() - interval '8 minutes', 'RUSH') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Cheese plate', 4, 'Machine', 'new', 0);

  -- #1052 — High
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1052', 'Griffith Park Studios', 'Tony', now() - interval '45 minutes', 'High') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'Junior pin', 20, 'Machine', 'new', 0),
    (oid, 'Baby plate', 10, 'Machine', 'new', 1);

  -- #1056 — High
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1056', 'Hand Held Films', 'Marco', now() - interval '95 minutes', 'High') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Turtle base', 2, 'Machine', 'new', 0);

  -- #1054 — Normal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1054', 'Keslow Camera', 'Front desk', now() - interval '210 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'Grid clamp', 16, 'Machine', 'new', 0),
    (oid, 'Sound blanket', 4, 'Sewing', 'new', 1);

  -- #1055 — Normal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1055', 'Quixote Studios', 'Purchasing', now() - interval '640 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'Offset arm', 8, 'Machine', 'new', 0),
    (oid, 'C-stand riser', 12, 'Machine', 'new', 1),
    (oid, 'Furni pad', 6, 'Sewing', 'new', 2);

  -- #1057 — Normal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1057', 'Sirui Rentals', 'Order desk', now() - interval '1320 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position)
    values (oid, 'Empty sandbag (15 lb)', 50, 'Sewing', 'new', 0);

  -- #1058 — Normal
  insert into public.orders (order_no, customer, contact, received_at, priority)
    values ('1058', 'Mole-Richardson', 'Shop', now() - interval '2100 minutes', 'Normal') returning id into oid;
  insert into public.items (order_id, name, qty, dept, stage, position) values
    (oid, 'Wall spreader', 6, 'Machine', 'new', 0),
    (oid, 'Scaffold clamp', 24, 'Machine', 'new', 1);
end $$;
