-- 0011_down.sql: remove the spending rollup function. Deploy the previous front end first; no data is touched.
begin;
drop function if exists spend_rollup(uuid, timestamptz, timestamptz, uuid);
commit;
