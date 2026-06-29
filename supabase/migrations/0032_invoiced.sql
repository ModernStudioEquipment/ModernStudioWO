-- 0032: "Invoiced" status on QuickBooks orders.
-- An order that came in as an INVOICE is already invoiced (its order number IS
-- the invoice number). A SALES ORDER starts un-invoiced until QuickBooks bills
-- it. The sync auto-marks a sales order invoiced once its linked invoice appears;
-- the box is also manually checkable (popup asks for the invoice number).
alter table public.orders add column if not exists invoiced boolean default false;
alter table public.orders add column if not exists invoice_number text;

-- Backfill existing orders: QB orders whose number starts with "4" came in as
-- invoices → already invoiced, number = order number. Sales orders (3xxxxx) and
-- everything else stay unchecked.
update public.orders
   set invoiced = true, invoice_number = order_no
 where source = 'QuickBooks' and order_no like '4%' and invoiced is not true;
