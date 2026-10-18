-- 0007_down.sql: back to 0006 (pool-only payments).
-- Expenses already paid from a card stay valid and can still be deleted (the money returns to that card).
begin;
drop function pay_common_bill(uuid,numeric,numeric,timestamptz,uuid);
drop function create_common_expense(uuid,text,numeric,text,uuid,numeric,text,uuid,timestamptz,uuid);
drop function _insert_common_expense(members,text,numeric,text,uuid,numeric,text,uuid,timestamptz,uuid,uuid);

create function _insert_common_expense(
  c members, p_title text, p_amount numeric, p_currency text, p_category_id uuid,
  p_lbp_per_usd numeric, p_note text, p_tagged uuid, p_created_at timestamptz, p_bill uuid
) returns common_expenses
language plpgsql security definer set search_path = public as $$
declare v_when timestamptz := coalesce(p_created_at, now()); v_net numeric; a wallet_accounts; r common_expenses;
begin
  if not _is_admin(c) then raise exception 'Only admins can record common expenses' using errcode = '42501'; end if;
  if nullif(btrim(p_title),'') is null then raise exception 'A common expense needs a title'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if p_currency not in ('USD','LBP') then raise exception 'Common expenses are paid in USD or LBP'; end if;
  if p_category_id is not null and not exists (select 1 from categories where id = p_category_id and family_id = c.family_id) then
    raise exception 'Category not found'; end if;
  if p_tagged is not null and not exists (select 1 from members where id = p_tagged and family_id = c.family_id and removed_at is null) then
    raise exception 'The tagged member is not part of this family'; end if;
  if p_currency = 'USD' then
    v_net := p_amount; p_lbp_per_usd := null;
  else
    perform _check_rate(c.family_id, p_lbp_per_usd, true);
    v_net := round(p_amount / p_lbp_per_usd, 4);
  end if;
  if v_net < 0.01 then raise exception 'Amount is too small'; end if;
  select * into a from wallet_accounts where family_id = c.family_id and owner_kind = 'pool' and currency = p_currency;
  if not found then raise exception 'Family pool wallet not found'; end if;
  perform _lock_accounts(array[a.id]);
  insert into common_expenses (family_id, title, amount, currency, lbp_per_usd, net_usd, category_id, tagged_member_id,
                               account_id, bill_id, note, created_by, created_at)
  values (c.family_id, btrim(p_title), p_amount, p_currency, p_lbp_per_usd, v_net, p_category_id, p_tagged,
          a.id, p_bill, nullif(btrim(p_note),''), c.id, v_when) returning * into r;
  insert into wallet_entries (account_id, amount, created_at, common_expense_id) values (a.id, -p_amount, v_when, r.id);
  perform _settle();
  return r;
end $$;

create function create_common_expense(
  p_family_id uuid, p_title text, p_amount numeric, p_currency text,
  p_category_id uuid default null, p_lbp_per_usd numeric default null, p_note text default null,
  p_tagged_member_id uuid default null, p_created_at timestamptz default null
) returns common_expenses
language plpgsql security definer set search_path = public as $$
declare c members;
begin
  c := _caller(p_family_id);
  return _insert_common_expense(c, p_title, p_amount, p_currency, p_category_id, p_lbp_per_usd, p_note,
                                p_tagged_member_id, p_created_at, null);
end $$;

create function pay_common_bill(
  p_bill_id uuid, p_amount numeric default null, p_lbp_per_usd numeric default null, p_created_at timestamptz default null
) returns common_expenses
language plpgsql security definer set search_path = public as $$
declare b common_bills; c members; r common_expenses;
begin
  select * into b from common_bills where id = p_bill_id for update;
  if not found or not b.is_active then raise exception 'Bill not found'; end if;
  c := _caller(b.family_id);
  r := _insert_common_expense(c, b.name, coalesce(p_amount, b.amount), b.currency, b.category_id, p_lbp_per_usd,
                              null, b.tagged_member_id, p_created_at, b.id);
  if b.recurrence = 'one_time' then
    update common_bills set is_active = false where id = b.id;
  elsif b.recurrence = 'weekly' then
    update common_bills set next_due_date = (next_due_date + 7) where id = b.id;
  else
    update common_bills set next_due_date = (next_due_date + interval '1 month')::date where id = b.id;
  end if;
  return r;
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_common_expense','pay_common_bill')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  execute 'revoke all on function _insert_common_expense(members,text,numeric,text,uuid,numeric,text,uuid,timestamptz,uuid) from public, anon, authenticated';
end $$;
commit;
