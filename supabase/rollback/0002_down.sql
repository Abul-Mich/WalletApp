-- Rollback of 0002: empties the ledger and clears the added columns' values.
-- Old tables are untouched, so nothing else is needed. Run before 0001_down.
begin;
alter table transactions      disable trigger trg_transactions_recalc;
alter table transactions      disable trigger trg_transactions_recalc_member_balance;
alter table transactions      disable trigger trg_transactions_check_balance;
alter table deposits          disable trigger trg_deposits_recalc;
alter table card_transactions disable trigger trg_card_transaction;

delete from wallet_entries;
delete from transaction_legs;
delete from opening_entries;
delete from transfers;
delete from exchanges;
update transactions set net_usd = null, lbp_per_usd = null;
update card_transactions set net_usd = null;
update deposits set account_id = null;
delete from wallet_accounts;

alter table transactions      enable trigger trg_transactions_recalc;
alter table transactions      enable trigger trg_transactions_recalc_member_balance;
alter table transactions      enable trigger trg_transactions_check_balance;
alter table deposits          enable trigger trg_deposits_recalc;
alter table card_transactions enable trigger trg_card_transaction;
drop function if exists ledger_reconcile();
commit;
