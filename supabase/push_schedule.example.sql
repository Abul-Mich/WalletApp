-- Schedules the morning bill alerts. Copy this file, fill in the two values, run it once in the SQL editor.
-- Do NOT commit the filled-in copy (it contains the cron secret).
-- The job runs at 06:00 and 07:00 UTC; the function itself only sends when it is 09:00 in Beirut,
-- so alerts arrive at 09:00 all year (Lebanon changes between UTC+2 and UTC+3).
-- Needs the pg_cron and pg_net extensions (Database -> Extensions).
select cron.schedule(
  'send-bill-alerts',
  '0 6,7 * * *',
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-bill-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
    body    := '{}'::jsonb
  );
  $$
);
-- To stop it later:  select cron.unschedule('send-bill-alerts');
