-- Auto-pull QuickBooks every 10 minutes (replaces clicking "Sync QuickBooks").
-- Runs entirely inside Supabase via pg_cron + pg_net — no Vercel cron (Hobby caps
-- at once/day) and no external service. Run this once in the Supabase SQL editor.
--
-- The sync endpoint is idempotent and deduped, so repeated runs only ever add
-- genuinely new orders — never duplicates. Overnight runs when the office PC is
-- off simply fail silently (logged in net._http_response), with no data impact.

-- 1. Enable the scheduler + HTTP-from-Postgres extensions (no-op if already on).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Schedule the sync every 10 minutes. Re-running this updates the job in place
--    (cron.schedule upserts by name), so it's safe to run again.
select cron.schedule(
  'quickbooks-auto-sync',
  '*/10 * * * *',
  $$
    select net.http_post(
      url := 'https://www.modern-fulfillment.com/api/conductor-sync',
      timeout_milliseconds := 60000
    );
  $$
);

-- --- handy management queries ---
-- See the job:            select * from cron.job where jobname = 'quickbooks-auto-sync';
-- See recent run results: select * from cron.job_run_details order by start_time desc limit 20;
-- See the HTTP responses: select status_code, content, created from net._http_response order by created desc limit 20;
-- Pause it:               select cron.unschedule('quickbooks-auto-sync');
