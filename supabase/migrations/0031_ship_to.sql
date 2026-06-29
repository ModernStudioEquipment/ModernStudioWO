-- 0031: capture the drop-ship recipient (the QuickBooks "Ship To" block). An
-- order billed to a reseller like "Barn Door Lighting" is often actually going
-- to THEIR customer (e.g. "Dylan M. Petraitis / Nashville Convention & Visitors").
-- We store that name here so the order is searchable by — and shows — where it's
-- really going, without changing the bill-to customer on the card.
alter table public.orders add column if not exists ship_to text;
