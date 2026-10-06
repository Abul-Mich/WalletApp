-- Rollback of 0004: restores direct writes and the old balance triggers.
-- SAFE ONLY IF NO NEW RECORDS WERE MADE since cutover (old balances are frozen).
-- If new records exist: export them first, run this, redeploy the old front end,
-- re-enter the few new records by hand (see the rollback ladder in the design doc).
begin;
grant all on
  transactions, deposits, card_transactions, card_transfers, member_balance_transfers,
  wallet_balance_adjustments, wallets, notifications, family_invites, members, families, cards
  to anon, authenticated;

create policy members_insert_self on members for insert with check (user_id = auth.uid());
drop policy if exists invites_select on family_invites;
create policy invites_select on family_invites for select using (family_id in (select my_family_ids()));
create policy invites_admin_insert on family_invites for insert with check (is_admin(family_id));
create policy invites_lookup_by_code on family_invites for select using (auth.uid() is not null);

create or replace function my_family_ids() returns setof uuid
language sql security definer stable as $$ select family_id from members where user_id = auth.uid(); $$;
create or replace function my_role_in(fam_id uuid) returns text
language sql security definer stable as $$ select role from members where user_id = auth.uid() and family_id = fam_id limit 1; $$;

create trigger trg_transactions_recalc after insert or update or delete on transactions
  for each row execute function recalc_wallet_balance();
create trigger trg_transactions_recalc_member_balance after insert or update or delete on transactions
  for each row execute function trg_fn_recalc_member_balance_on_txn();
create trigger trg_transactions_check_balance before insert or update on transactions
  for each row execute function check_transaction_covers_balance();
create trigger trg_deposits_recalc after insert or update or delete on deposits
  for each row execute function recalc_wallet_balance();
create trigger trg_card_transaction after insert or update or delete on card_transactions
  for each row execute function handle_card_transaction();
create trigger trg_card_transfer after insert or update or delete on card_transfers
  for each row execute function handle_card_transfer();
create trigger trg_member_balance_transfer after insert or update or delete on member_balance_transfers
  for each row execute function handle_member_balance_transfer();
create trigger trg_wallet_adjustments_recalc after insert or update or delete on wallet_balance_adjustments
  for each row execute function recalc_wallet_balance();
create trigger trg_wallet_adjustments_check before insert or update or delete on wallet_balance_adjustments
  for each row execute function check_wallet_adjustment_covers_allocations();

drop function if exists create_family(text,text), create_invite(uuid), join_family(text,text),
  set_member_limit(uuid,numeric,text), set_role(uuid,text), remove_member(uuid), _new_member_accounts(uuid,uuid);
commit;
