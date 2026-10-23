-- Rollback of 0018: removes the two edit functions. No data is touched.
begin;
drop function if exists update_income(uuid, numeric, text, numeric, uuid, text, timestamptz, uuid);
drop function if exists update_common_bill(uuid, text, numeric, text, text, date, uuid, uuid);
commit;
