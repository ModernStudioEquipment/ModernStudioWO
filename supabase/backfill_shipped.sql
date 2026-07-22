-- Backfill: move already-shipped orders (per QuickBooks "Fulfillment - Shipped" report) into Shipped.
-- Generated 35 rows. Idempotent: only touches orders not already shipped. Wrapped in a transaction.
begin;

with shipped(order_no, carrier, tracking) as (
  values
    ('472798','FedEx','8725094659386'),
    ('472799','FedEx','8725052509345'),
    ('472800','FedEx','8725034791456'),
    ('472801','FedEx','8725045355356'),
    ('472802','FedEx','3819087843206'),
    ('472803','FedEx','3817669276796'),
    ('472804','FedEx','8725029960206'),
    ('472806','FedEx','8725067935706'),
    ('472807','FedEx','8725022756206'),
    ('472808','FedEx','3818436540256'),
    ('472811','FedEx','3817626377466'),
    ('472812','FedEx','8725040275996'),
    ('472816','FedEx','8725072896066'),
    ('472824','FedEx','3817637924406'),
    ('472826','FedEx','3817633363806'),
    ('472830','FedEx','3817630231326'),
    ('472838','FedEx','3819206166996'),
    ('472839','FedEx','3818378622406'),
    ('472840','FedEx','3817876362065'),
    ('472841','FedEx','3817880480376'),
    ('472844','Freight','BOL P371280C'),
    ('472848','FedEx','3819722029096'),
    ('472850','FedEx','3818176194826'),
    ('472853','FedEx','3818093475016'),
    ('472855','FedEx','3818090830196'),
    ('472856','FedEx','3818175032196'),
    ('472857','UPS','1Z9E371R03984116036'),
    ('472861','UPS','1Z9E371R03984116036'),
    ('472862','FedEx','3818125408306'),
    ('472863','FedEx','3818930690486'),
    ('472865','FedEx','3818146646376'),
    ('472875','FedEx','3818369005696'),
    ('472877','FedEx','8727151048366'),
    ('472878','FedEx','3818364135876'),
    ('472884','UPS','1Z9E371R03927029616')
)
update public.orders o
   set fulfillment        = 'shipping',
       fulfillment_method = 'shipping',
       carrier            = s.carrier,
       tracking_number    = s.tracking,
       shipped_at         = coalesce(o.shipped_at,  now()),
       fulfilled_at       = coalesce(o.fulfilled_at, now())
  from shipped s
 where o.order_no = s.order_no
   and (o.fulfillment is distinct from 'shipping' or o.tracking_number is null);

-- Mark any still-open items on those orders done so they read as complete.
update public.items i
   set stage = 'done'
  from (values
    ('472798','FedEx','8725094659386'),
    ('472799','FedEx','8725052509345'),
    ('472800','FedEx','8725034791456'),
    ('472801','FedEx','8725045355356'),
    ('472802','FedEx','3819087843206'),
    ('472803','FedEx','3817669276796'),
    ('472804','FedEx','8725029960206'),
    ('472806','FedEx','8725067935706'),
    ('472807','FedEx','8725022756206'),
    ('472808','FedEx','3818436540256'),
    ('472811','FedEx','3817626377466'),
    ('472812','FedEx','8725040275996'),
    ('472816','FedEx','8725072896066'),
    ('472824','FedEx','3817637924406'),
    ('472826','FedEx','3817633363806'),
    ('472830','FedEx','3817630231326'),
    ('472838','FedEx','3819206166996'),
    ('472839','FedEx','3818378622406'),
    ('472840','FedEx','3817876362065'),
    ('472841','FedEx','3817880480376'),
    ('472844','Freight','BOL P371280C'),
    ('472848','FedEx','3819722029096'),
    ('472850','FedEx','3818176194826'),
    ('472853','FedEx','3818093475016'),
    ('472855','FedEx','3818090830196'),
    ('472856','FedEx','3818175032196'),
    ('472857','UPS','1Z9E371R03984116036'),
    ('472861','UPS','1Z9E371R03984116036'),
    ('472862','FedEx','3818125408306'),
    ('472863','FedEx','3818930690486'),
    ('472865','FedEx','3818146646376'),
    ('472875','FedEx','3818369005696'),
    ('472877','FedEx','8727151048366'),
    ('472878','FedEx','3818364135876'),
    ('472884','UPS','1Z9E371R03927029616')
) as s(order_no, carrier, tracking)
  join public.orders o on o.order_no = s.order_no
 where i.order_id = o.id and i.stage <> 'done';

commit;
