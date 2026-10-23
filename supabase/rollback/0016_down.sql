-- Rollback of 0016: removes phone-alert device registrations (people just turn alerts on again afterwards).
begin;
drop function if exists save_push_subscription(text, text, text, text);
drop function if exists remove_push_subscription(text);
drop table if exists push_subscriptions;
commit;
