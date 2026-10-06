-- Rollback of 0001: drops everything 0001 created. Run only if 0002+ are also rolled back.
begin;
drop table if exists wallet_entries cascade;
drop function if exists wallet_entries_recalc() cascade;
drop function if exists wallet_entries_nonneg() cascade;
drop function if exists _settle();
drop table if exists transaction_legs cascade;
drop table if exists opening_entries cascade;
drop table if exists exchanges cascade;
drop table if exists transfers cascade;
drop table if exists wallet_accounts cascade;
alter table transactions      drop column if exists net_usd, drop column if exists lbp_per_usd;
alter table card_transactions drop column if exists net_usd;
alter table deposits          drop column if exists account_id;
alter table members           drop column if exists removed_at;
commit;
