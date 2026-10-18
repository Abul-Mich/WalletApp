-- 0012_down.sql: remove the edit functions for card spending and common expenses.
-- Records already edited keep their new values. Deploy the previous front end first.
begin;
drop function if exists update_card_spend(uuid,numeric,text,numeric,timestamptz,uuid,uuid);
drop function if exists update_common_expense(uuid,text,numeric,text,uuid,numeric,text,uuid,timestamptz,uuid);
commit;
