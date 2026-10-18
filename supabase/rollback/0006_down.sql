-- 0006_down.sql: remove common expenses.
-- WARNING: deleting a common expense puts its money back into the pool. Only use this before
-- real common expenses have been recorded, or export common_expenses first and accept that
-- the pool balance changes.
begin;
drop function if exists pay_common_bill(uuid,numeric,numeric,timestamptz);
drop function if exists delete_common_bill(uuid);
drop function if exists create_common_bill(uuid,text,numeric,text,text,date,uuid,uuid);
drop function if exists delete_common_expense(uuid);
drop function if exists create_common_expense(uuid,text,numeric,text,uuid,numeric,text,uuid,timestamptz);
drop function if exists _insert_common_expense(members,text,numeric,text,uuid,numeric,text,uuid,timestamptz,uuid);

create or replace function period_spend(p_family_id uuid, p_member_id uuid default null, p_category_id uuid default null,
                             p_from timestamptz default null, p_to timestamptz default null) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  perform _caller(p_family_id);
  select coalesce(sum(net_usd),0) into v from (
    select net_usd from transactions
     where family_id = p_family_id and (p_member_id is null or member_id = p_member_id)
       and (p_category_id is null or category_id = p_category_id)
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
    union all
    select net_usd from card_transactions
     where p_category_id is null and family_id = p_family_id and (p_member_id is null or coalesce(tagged_member_id, member_id) = p_member_id)
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ) s;
  return v;
end $$;

do $$
begin
  if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='common_expenses') then
    alter publication supabase_realtime drop table common_expenses; end if;
  if exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='common_bills') then
    alter publication supabase_realtime drop table common_bills; end if;
end $$;

delete from wallet_entries where common_expense_id is not null;       -- refunds the pool
alter table wallet_entries drop constraint wallet_entries_one_source;
alter table wallet_entries drop column common_expense_id;
alter table wallet_entries add constraint wallet_entries_check check (
  num_nonnulls(deposit_id, adjustment_id, opening_id, transfer_id, exchange_id, leg_id, card_txn_id) = 1);
drop table common_expenses;
drop table common_bills;
commit;
