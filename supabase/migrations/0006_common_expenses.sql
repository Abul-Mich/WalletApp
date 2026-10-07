-- ============================================================================
-- 0006 · Common (family) expenses: electricity, water, wifi, tuition, ...
--  * Paid out of the family POOL (USD or LBP). Admins only.
--  * Count toward the family budget, category budgets and statistics.
--  * They do NOT count toward any member's personal limit.
--  * Optional "for <member>" tag (e.g. a student's tuition).
--  * Recurring bills (common_bills) are paid with pay_common_bill(), which records the
--    expense and moves the due date forward in one step.
-- Safe to run any time after 0005. The running app ignores the new tables.
-- Rollback: rollback/0006_down.sql
-- ============================================================================
begin;

create table common_bills (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references families(id) on delete cascade,
  name             text not null check (btrim(name) <> ''),
  amount           numeric not null check (amount > 0),          -- the usual amount (a payment can differ)
  currency         text not null check (currency in ('USD','LBP')),
  recurrence       text not null check (recurrence in ('monthly','weekly','one_time')),
  next_due_date    date not null,
  category_id      uuid references categories(id) on delete set null,
  tagged_member_id uuid references members(id),
  is_active        boolean not null default true,
  created_by       uuid references members(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index common_bills_family_idx on common_bills (family_id, is_active, next_due_date);

create table common_expenses (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references families(id) on delete cascade,
  title            text not null check (btrim(title) <> ''),
  amount           numeric not null check (amount > 0),          -- in `currency`
  currency         text not null check (currency in ('USD','LBP')),
  lbp_per_usd      numeric,                                      -- set when currency = LBP
  net_usd          numeric not null check (net_usd > 0),
  category_id      uuid references categories(id) on delete set null,
  tagged_member_id uuid references members(id),
  account_id       uuid not null references wallet_accounts(id),  -- the pool wallet it was paid from
  bill_id          uuid references common_bills(id) on delete set null,
  note             text,
  created_by       uuid references members(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index common_expenses_family_idx on common_expenses (family_id, created_at desc);
create index common_expenses_tag_idx on common_expenses (tagged_member_id) where tagged_member_id is not null;

-- ledger entries may now come from a common expense
alter table wallet_entries add column common_expense_id uuid references common_expenses(id) on delete cascade;
create index wallet_entries_common_idx on wallet_entries (common_expense_id) where common_expense_id is not null;
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'wallet_entries'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%num_nonnulls%';
  if v_name is not null then execute format('alter table wallet_entries drop constraint %I', v_name); end if;
end $$;
alter table wallet_entries add constraint wallet_entries_one_source check (
  num_nonnulls(deposit_id, adjustment_id, opening_id, transfer_id, exchange_id, leg_id, card_txn_id, common_expense_id) = 1);

-- read-only for family members; all writes go through the functions below
alter table common_bills    enable row level security;
alter table common_expenses enable row level security;
create policy common_bills_select    on common_bills    for select using (family_id in (select my_family_ids()));
create policy common_expenses_select on common_expenses for select using (family_id in (select my_family_ids()));
revoke all on common_bills, common_expenses from anon, authenticated;
grant select on common_bills, common_expenses to authenticated;

-- ------------------------------------------------------------ functions ----
-- shared by create_common_expense and pay_common_bill (not callable from the app)
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

create function delete_common_expense(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r common_expenses; c members;
begin
  select * into r from common_expenses where id = p_id for update;
  if not found then raise exception 'Common expense not found'; end if;
  c := _caller(r.family_id);
  if not _is_admin(c) then raise exception 'Only admins can delete common expenses' using errcode = '42501'; end if;
  perform _lock_accounts(array[r.account_id]);
  delete from common_expenses where id = p_id;                         -- the ledger entry cascades
  perform _settle();
end $$;

create function create_common_bill(
  p_family_id uuid, p_name text, p_amount numeric, p_currency text, p_recurrence text, p_next_due date,
  p_category_id uuid default null, p_tagged_member_id uuid default null
) returns common_bills
language plpgsql security definer set search_path = public as $$
declare c members; b common_bills;
begin
  c := _caller(p_family_id);
  if not _is_admin(c) then raise exception 'Only admins can add common bills' using errcode = '42501'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'A bill needs a name'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if p_currency not in ('USD','LBP') then raise exception 'Bills are in USD or LBP'; end if;
  if p_recurrence not in ('monthly','weekly','one_time') then raise exception 'Repeat must be monthly, weekly or one time'; end if;
  if p_next_due is null then raise exception 'A bill needs a due date'; end if;
  if p_category_id is not null and not exists (select 1 from categories where id = p_category_id and family_id = p_family_id) then
    raise exception 'Category not found'; end if;
  if p_tagged_member_id is not null and not exists (select 1 from members where id = p_tagged_member_id and family_id = p_family_id and removed_at is null) then
    raise exception 'The tagged member is not part of this family'; end if;
  insert into common_bills (family_id, name, amount, currency, recurrence, next_due_date, category_id, tagged_member_id, created_by)
  values (p_family_id, btrim(p_name), p_amount, p_currency, p_recurrence, p_next_due, p_category_id, p_tagged_member_id, c.id)
  returning * into b;
  return b;
end $$;

create function delete_common_bill(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b common_bills; c members;
begin
  select * into b from common_bills where id = p_id for update;
  if not found then raise exception 'Bill not found'; end if;
  c := _caller(b.family_id);
  if not _is_admin(c) then raise exception 'Only admins can delete common bills' using errcode = '42501'; end if;
  delete from common_bills where id = p_id;                            -- paid expenses stay (bill_id becomes empty)
end $$;

-- Pay a bill from the pool: records the expense and moves the due date on, in one step.
-- p_amount defaults to the bill's usual amount (electricity varies, so you can pass the real figure).
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

-- Family budget and category budgets now include common expenses; a member's own limit does not.
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
    union all
    select net_usd from common_expenses
     where p_member_id is null and family_id = p_family_id
       and (p_category_id is null or category_id = p_category_id)
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ) s;
  return v;
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in
             ('create_common_expense','delete_common_expense','create_common_bill','delete_common_bill','pay_common_bill','period_spend')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  execute 'revoke all on function _insert_common_expense(members,text,numeric,text,uuid,numeric,text,uuid,timestamptz,uuid) from public, anon, authenticated';
end $$;

-- realtime (the app refreshes when another family member records something)
do $$
declare t text;
begin
  foreach t in array array['common_expenses','common_bills']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

commit;
