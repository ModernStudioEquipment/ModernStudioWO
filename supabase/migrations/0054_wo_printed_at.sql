-- 0054: the official work-order date for an order — the moment a work order for
-- it was FIRST printed.
--
-- Until now every sheet printed today's date, so reprinting an order a week
-- later produced a sheet claiming to be a week newer than the job actually was.
-- Two people holding two printouts of the same job saw two different dates and
-- had no way to tell which was the real one.
--
-- Set once and never again: the whole point is that it can't drift. The stamp is
-- applied by the function below rather than by the client, so it can't be
-- back-dated or overwritten from the app.
alter table public.orders add column if not exists wo_printed_at timestamptz;

comment on column public.orders.wo_printed_at is
  'When a work order for this order was first printed. Immutable — set once by mark_wo_printed().';

-- Stamp the first print. Later calls are a no-op, so ANY sheet printed from this
-- order afterwards — another department, another product, a reprint — keeps
-- showing the original date.
--
-- The `is null` lives in the WHERE clause so two people hitting print at the same
-- moment can't race: the second update simply matches no rows.
create or replace function public.mark_wo_printed(p_order_id uuid)
returns timestamptz language plpgsql security invoker as $$
declare v_at timestamptz;
begin
  update public.orders
     set wo_printed_at = now()
   where id = p_order_id
     and wo_printed_at is null;

  select wo_printed_at into v_at from public.orders where id = p_order_id;
  return v_at;   -- always the FIRST print, whether this call set it or not
end;
$$;
