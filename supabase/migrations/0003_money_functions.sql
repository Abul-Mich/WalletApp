-- ============================================================================
-- 0003 · Money functions. Every money write in the app goes through these.
--  * SECURITY DEFINER, fixed search_path, identity ALWAYS from auth.uid().
--  * They only become the way to write when 0004 revokes direct writes.
--  * Safe to run before cutover: nothing calls them yet.
-- Rollback: rollback/0003_down.sql
-- ============================================================================
begin;

-- ---------------------------------------------------------------- helpers --
create function _caller(p_family uuid) returns members
language plpgsql stable security definer set search_path = public as $$
declare m members;
begin
  select * into m from members
   where family_id = p_family and user_id = auth.uid() and removed_at is null;
  if not found then raise exception 'You are not a member of this family' using errcode = '42501'; end if;
  return m;
end $$;

create function _is_admin(m members) returns boolean
language sql immutable as $$ select m.role in ('admin','superadmin') $$;

create function _lock_accounts(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from wallet_accounts where id = any(p_ids) order by id for update;   -- fixed order: no deadlocks
end $$;

create function _member_acct(p_member uuid, p_currency text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from wallet_accounts where member_id = p_member and owner_kind = 'member' and currency = p_currency
$$;

-- LBP per USD must be inside the absolute range for everyone; non-admins must also be
-- within 10% of the family's most recent rate (blocks typos and money-minting rates).
create function _check_rate(p_family uuid, p_rate numeric, p_admin boolean) returns void
language plpgsql stable security definer set search_path = public as $$
declare v_ref numeric;
begin
  if p_rate is null or p_rate < 1000 or p_rate > 10000000 then
    raise exception 'LBP per USD rate is missing or outside the allowed range (1,000 to 10,000,000)';
  end if;
  if p_admin then return; end if;
  select r into v_ref from (
    select created_at, lbp_per_usd as r from transactions where family_id = p_family and lbp_per_usd is not null
    union all
    select created_at, lbp_per_usd from exchanges where family_id = p_family
  ) x order by created_at desc limit 1;
  if v_ref is not null and (p_rate < v_ref * 0.9 or p_rate > v_ref * 1.1) then
    raise exception 'The rate % is more than 10 percent away from the family rate (about %). Ask an admin to enter it.',
      round(p_rate), round(v_ref);
  end if;
end $$;

-- Net USD value of a set of legs: -(sum USD legs) - (sum LBP legs)/rate
create function _net_usd(p_legs jsonb, p_rate numeric) returns numeric
language plpgsql immutable set search_path = public as $$
declare l jsonb; usd numeric := 0; lbp numeric := 0; paid boolean := false; n numeric;
begin
  if p_legs is null or jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) = 0 then
    raise exception 'An expense needs at least one payment leg';
  end if;
  for l in select * from jsonb_array_elements(p_legs) loop
    if (l->>'currency') not in ('USD','LBP') then raise exception 'Legs must be in USD or LBP'; end if;
    n := (l->>'amount')::numeric;
    if n is null or n = 0 then raise exception 'A leg amount cannot be empty or zero'; end if;
    if n < 0 then paid := true; end if;
    if (l->>'currency') = 'USD' then usd := usd + n; else lbp := lbp + n; end if;
  end loop;
  if not paid then raise exception 'At least one leg must be a payment (negative amount)'; end if;
  if lbp <> 0 then
    if p_rate is null or p_rate < 1000 or p_rate > 10000000 then
      raise exception 'LBP per USD rate is missing or outside the allowed range (1,000 to 10,000,000)';
    end if;
  end if;
  return round(-usd - (case when lbp = 0 then 0 else lbp / p_rate end), 4);
end $$;

-- Writes the legs + their ledger entries for one expense
create function _write_legs(p_txn uuid, p_member uuid, p_legs jsonb, p_created timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare l jsonb; v_acct uuid; v_leg uuid; v_ids uuid[];
begin
  select array_agg(distinct _member_acct(p_member, x->>'currency')) into v_ids from jsonb_array_elements(p_legs) x;
  perform _lock_accounts(v_ids);
  for l in select * from jsonb_array_elements(p_legs) loop
    v_acct := _member_acct(p_member, l->>'currency');
    if v_acct is null then raise exception 'Member wallet not found'; end if;
    insert into transaction_legs (transaction_id, account_id, amount, created_at)
    values (p_txn, v_acct, (l->>'amount')::numeric, p_created) returning id into v_leg;
    insert into wallet_entries (account_id, amount, created_at, leg_id)
    values (v_acct, (l->>'amount')::numeric, p_created, v_leg);
  end loop;
end $$;

-- ---------------------------------------------------------------- expenses --
-- p_legs: [{"currency":"USD","amount":-10},{"currency":"LBP","amount":-900000},{"currency":"USD","amount":5}]
-- negative = paid from that wallet, positive = change received into it.
create function create_expense(
  p_member_id uuid, p_category_id uuid, p_note text, p_legs jsonb,
  p_lbp_per_usd numeric default null, p_created_at timestamptz default null,
  p_original_amount numeric default null, p_original_currency text default null
) returns transactions
language plpgsql security definer set search_path = public as $$
declare v_fam uuid; c members; v_net numeric; t transactions; v_when timestamptz := coalesce(p_created_at, now());
        v_amt numeric; v_cur text := coalesce(p_original_currency, 'USD');
begin
  select family_id into v_fam from members where id = p_member_id and removed_at is null;
  if v_fam is null then raise exception 'Member not found'; end if;
  c := _caller(v_fam);
  if c.id <> p_member_id and not _is_admin(c) then raise exception 'You can only add your own expenses' using errcode = '42501'; end if;
  if p_lbp_per_usd is not null then perform _check_rate(v_fam, p_lbp_per_usd, _is_admin(c)); end if;
  if p_category_id is not null and not exists (select 1 from categories where id = p_category_id and family_id = v_fam) then
    raise exception 'Category not found'; end if;
  if v_cur not in ('USD','EUR','GBP','LBP') then raise exception 'Unsupported currency'; end if;
  v_net := _net_usd(p_legs, p_lbp_per_usd);
  if v_net <= 0 then raise exception 'The net amount spent must be more than zero'; end if;
  v_amt := coalesce(p_original_amount, v_net);
  if v_amt <= 0 then raise exception 'Original amount must be positive'; end if;

  insert into transactions (family_id, member_id, amount, currency, exchange_rate_to_base, category_id, note,
                            created_at, net_usd, lbp_per_usd)
  values (v_fam, p_member_id, v_amt, v_cur, v_net / v_amt, p_category_id, nullif(btrim(p_note),''),
          v_when, v_net, p_lbp_per_usd)
  returning * into t;
  perform _write_legs(t.id, p_member_id, p_legs, v_when);
  perform _settle();
  return t;
end $$;

create function update_expense(
  p_id uuid, p_category_id uuid, p_note text, p_legs jsonb,
  p_lbp_per_usd numeric default null, p_created_at timestamptz default null,
  p_original_amount numeric default null, p_original_currency text default null
) returns transactions
language plpgsql security definer set search_path = public as $$
declare t transactions; c members; v_net numeric; v_when timestamptz; v_amt numeric; v_cur text;
begin
  select * into t from transactions where id = p_id for update;
  if not found then raise exception 'Expense not found'; end if;
  c := _caller(t.family_id);
  if c.id <> t.member_id and not _is_admin(c) then raise exception 'You can only edit your own expenses' using errcode = '42501'; end if;
  if p_lbp_per_usd is not null then perform _check_rate(t.family_id, p_lbp_per_usd, _is_admin(c)); end if;
  perform _lock_accounts((select array_agg(account_id) from transaction_legs where transaction_id = t.id));
  if p_category_id is not null and not exists (select 1 from categories where id = p_category_id and family_id = t.family_id) then
    raise exception 'Category not found'; end if;
  v_cur := coalesce(p_original_currency, case when t.currency in ('USD','EUR','GBP','LBP') then t.currency else 'USD' end);
  v_net := _net_usd(p_legs, p_lbp_per_usd);
  if v_net <= 0 then raise exception 'The net amount spent must be more than zero'; end if;
  v_amt := coalesce(p_original_amount, v_net);
  v_when := coalesce(p_created_at, t.created_at);

  delete from transaction_legs where transaction_id = t.id;          -- cascades to entries
  update transactions set amount = v_amt, currency = v_cur, exchange_rate_to_base = v_net / v_amt,
         category_id = p_category_id, note = nullif(btrim(p_note),''), created_at = v_when,
         net_usd = v_net, lbp_per_usd = p_lbp_per_usd
   where id = t.id returning * into t;
  perform _write_legs(t.id, t.member_id, p_legs, v_when);
  perform _settle();
  return t;
end $$;

create function delete_expense(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t transactions; c members;
begin
  select * into t from transactions where id = p_id for update;
  if not found then raise exception 'Expense not found'; end if;
  c := _caller(t.family_id);
  if c.id <> t.member_id and not _is_admin(c) then raise exception 'You can only delete your own expenses' using errcode = '42501'; end if;
  perform _lock_accounts((select array_agg(account_id) from transaction_legs where transaction_id = t.id));
  delete from transactions where id = p_id;                           -- legs + entries cascade
  perform _settle();
end $$;

-- ---------------------------------------------------------------- deposits --
create function create_deposit(p_account_id uuid, p_amount numeric, p_lbp_per_usd numeric default null,
                               p_created_at timestamptz default null) returns deposits
language plpgsql security definer set search_path = public as $$
declare a wallet_accounts; c members; d deposits; v_when timestamptz := coalesce(p_created_at, now()); v_rate numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  select * into a from wallet_accounts where id = p_account_id;
  if not found then raise exception 'Wallet not found'; end if;
  c := _caller(a.family_id);
  if not _is_admin(c) then raise exception 'Only admins can add money to the family' using errcode = '42501'; end if;
  if a.owner_kind = 'card' then raise exception 'Use a transfer to fund a card'; end if;
  if p_amount < 0.01 then raise exception 'Amount is too small'; end if;
  if a.currency = 'USD' then v_rate := 1;
  else
    perform _check_rate(a.family_id, p_lbp_per_usd, true);
    v_rate := 1 / p_lbp_per_usd;
  end if;
  perform _lock_accounts(array[a.id]);
  insert into deposits (family_id, added_by_member_id, amount, currency, exchange_rate_to_base, account_id, created_at)
  values (a.family_id, c.id, p_amount, a.currency, v_rate, a.id, v_when) returning * into d;
  insert into wallet_entries (account_id, amount, created_at, deposit_id) values (a.id, p_amount, v_when, d.id);
  perform _settle();
  return d;
end $$;

create function delete_deposit(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d deposits; c members; a wallet_accounts;
begin
  select * into d from deposits where id = p_id for update;
  if not found then raise exception 'Deposit not found'; end if;
  c := _caller(d.family_id);
  select * into a from wallet_accounts where id = d.account_id;
  if not _is_admin(c) then raise exception 'Only admins can delete a deposit' using errcode = '42501'; end if;
  perform _lock_accounts(array[d.account_id]);
  delete from deposits where id = p_id;                               -- entry cascades; non-negative rule judged at commit
  perform _settle();
end $$;

-- --------------------------------------------------------------- transfers --
create function create_transfer(p_from uuid, p_to uuid, p_amount numeric, p_note text default null,
                                p_created_at timestamptz default null) returns transfers
language plpgsql security definer set search_path = public as $$
declare f wallet_accounts; t wallet_accounts; c members; r transfers; v_when timestamptz := coalesce(p_created_at, now()); ok boolean;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if p_from = p_to then raise exception 'Choose two different wallets'; end if;
  select * into f from wallet_accounts where id = p_from;
  select * into t from wallet_accounts where id = p_to;
  if f.id is null or t.id is null then raise exception 'Wallet not found'; end if;
  if f.family_id <> t.family_id then raise exception 'Wallets belong to different families'; end if;
  if f.currency <> t.currency then raise exception 'Transfers need the same currency; use an exchange instead'; end if;
  c := _caller(f.family_id);
  if p_amount < 0.01 then raise exception 'Amount is too small'; end if;
  if exists (select 1 from members where removed_at is not null and id in (f.member_id, t.member_id)) then
    raise exception 'This member was removed from the family'; end if;
  ok := _is_admin(c)
     or (f.owner_kind = 'pool'   and t.owner_kind = 'member' and t.member_id = c.id)
     or (f.owner_kind = 'member' and t.owner_kind = 'pool'   and f.member_id = c.id)
     or (f.owner_kind = 'pool'   and t.owner_kind = 'card');
  if not ok then raise exception 'You are not allowed to move money between these wallets' using errcode = '42501'; end if;
  perform _lock_accounts(array[p_from, p_to]);
  insert into transfers (family_id, from_account_id, to_account_id, amount, created_by, note, created_at)
  values (f.family_id, p_from, p_to, p_amount, c.id, nullif(btrim(p_note),''), v_when) returning * into r;
  insert into wallet_entries (account_id, amount, created_at, transfer_id) values (p_from, -p_amount, v_when, r.id);
  insert into wallet_entries (account_id, amount, created_at, transfer_id) values (p_to,    p_amount, v_when, r.id);

  if f.owner_kind = 'pool' and t.owner_kind = 'member' then
    insert into notifications (family_id, type, member_id, amount) values (f.family_id, 'member_topup', t.member_id, p_amount);
  elsif f.owner_kind = 'member' and t.owner_kind = 'pool' then
    insert into notifications (family_id, type, member_id, amount) values (f.family_id, 'member_return', f.member_id, p_amount);
  elsif f.owner_kind = 'pool' and t.owner_kind = 'card' then
    insert into notifications (family_id, type, member_id, card_id, amount) values (f.family_id, 'card_topup', c.id, t.card_id, p_amount);
  end if;
  perform _settle();
  return r;
end $$;

create function delete_transfer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r transfers; c members;
begin
  select * into r from transfers where id = p_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  c := _caller(r.family_id);
  if not _is_admin(c) then raise exception 'Only admins can delete a transfer' using errcode = '42501'; end if;
  perform _lock_accounts(array[r.from_account_id, r.to_account_id]);
  delete from transfers where id = p_id;
  perform _settle();
end $$;

-- --------------------------------------------------------------- exchanges --
create function create_exchange(p_from uuid, p_to uuid, p_amount_from numeric, p_amount_to numeric,
                                p_created_at timestamptz default null) returns exchanges
language plpgsql security definer set search_path = public as $$
declare f wallet_accounts; t wallet_accounts; c members; r exchanges; v_when timestamptz := coalesce(p_created_at, now());
        v_usd numeric; v_lbp numeric;
begin
  if p_amount_from is null or p_amount_from <= 0 or p_amount_to is null or p_amount_to <= 0 then
    raise exception 'Both amounts must be more than zero'; end if;
  select * into f from wallet_accounts where id = p_from;
  select * into t from wallet_accounts where id = p_to;
  if f.id is null or t.id is null then raise exception 'Wallet not found'; end if;
  if f.currency = t.currency then raise exception 'An exchange needs two different currencies'; end if;
  if f.family_id <> t.family_id or f.owner_kind <> t.owner_kind or f.member_id is distinct from t.member_id then
    raise exception 'Exchange only works between the two wallets of the same holder'; end if;
  if f.owner_kind = 'card' then raise exception 'Cards cannot exchange currencies'; end if;
  c := _caller(f.family_id);
  if f.owner_kind = 'pool' and not _is_admin(c) then raise exception 'Only admins can exchange in the family pool' using errcode = '42501'; end if;
  if f.owner_kind = 'member' and f.member_id <> c.id then raise exception 'You can only exchange in your own wallets' using errcode = '42501'; end if;
  if f.currency = 'USD' then v_usd := p_amount_from; v_lbp := p_amount_to; else v_usd := p_amount_to; v_lbp := p_amount_from; end if;
  if v_usd < 0.01 then raise exception 'Amount is too small'; end if;
  perform _check_rate(f.family_id, v_lbp / v_usd, _is_admin(c));
  perform _lock_accounts(array[p_from, p_to]);
  insert into exchanges (family_id, from_account_id, to_account_id, amount_from, amount_to, lbp_per_usd, created_by, created_at)
  values (f.family_id, p_from, p_to, p_amount_from, p_amount_to, round(v_lbp / v_usd, 4), c.id, v_when) returning * into r;
  insert into wallet_entries (account_id, amount, created_at, exchange_id) values (p_from, -p_amount_from, v_when, r.id);
  insert into wallet_entries (account_id, amount, created_at, exchange_id) values (p_to,    p_amount_to,   v_when, r.id);
  perform _settle();
  return r;
end $$;

create function delete_exchange(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r exchanges; c members; f wallet_accounts;
begin
  select * into r from exchanges where id = p_id for update;
  if not found then raise exception 'Exchange not found'; end if;
  c := _caller(r.family_id);
  select * into f from wallet_accounts where id = r.from_account_id;
  if not _is_admin(c) and not (f.owner_kind = 'member' and f.member_id = c.id) then
    raise exception 'Not allowed to delete this exchange' using errcode = '42501'; end if;
  perform _lock_accounts(array[r.from_account_id, r.to_account_id]);
  delete from exchanges where id = p_id;
  perform _settle();
end $$;

-- ------------------------------------------------------------------- cards --
create function create_card(p_family_id uuid, p_name text, p_currency text default 'USD') returns cards
language plpgsql security definer set search_path = public as $$
declare c members; k cards;
begin
  c := _caller(p_family_id);
  if not _is_admin(c) then raise exception 'Only admins can create cards' using errcode = '42501'; end if;
  if p_currency not in ('USD','LBP') then raise exception 'A card holds USD or LBP'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'A card needs a name'; end if;
  insert into cards (family_id, name, created_by) values (p_family_id, btrim(p_name), c.id) returning * into k;
  insert into wallet_accounts (family_id, owner_kind, card_id, currency) values (p_family_id, 'card', k.id, p_currency);
  return k;
end $$;

-- Spending from a card counts toward the spender's limits (net_usd), D20.
create function create_card_spend(p_card_id uuid, p_amount numeric, p_note text default null,
                                  p_lbp_per_usd numeric default null, p_created_at timestamptz default null)
returns card_transactions
language plpgsql security definer set search_path = public as $$
declare k cards; a wallet_accounts; c members; r card_transactions; v_when timestamptz := coalesce(p_created_at, now()); v_net numeric;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  select * into k from cards where id = p_card_id;
  if not found then raise exception 'Card not found'; end if;
  if k.archived then raise exception 'This card is archived and can no longer be used'; end if;
  c := _caller(k.family_id);
  select * into a from wallet_accounts where card_id = k.id;
  if a.currency = 'USD' then v_net := p_amount;
  else
    perform _check_rate(k.family_id, p_lbp_per_usd, _is_admin(c));
    v_net := round(p_amount / p_lbp_per_usd, 4);
  end if;
  perform _lock_accounts(array[a.id]);
  insert into card_transactions (family_id, card_id, member_id, amount, currency, exchange_rate_to_base, note, created_at, net_usd)
  values (k.family_id, k.id, c.id, p_amount, a.currency, v_net / p_amount, nullif(btrim(p_note),''), v_when, v_net)
  returning * into r;
  insert into wallet_entries (account_id, amount, created_at, card_txn_id) values (a.id, -p_amount, v_when, r.id);
  insert into notifications (family_id, type, member_id, card_id, amount) values (k.family_id, 'card_withdraw', c.id, k.id, v_net);
  perform _settle();
  return r;
end $$;

create function delete_card_spend(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r card_transactions; c members;
begin
  select * into r from card_transactions where id = p_id for update;
  if not found then raise exception 'Card spending not found'; end if;
  c := _caller(r.family_id);
  if c.id <> r.member_id and c.role <> 'superadmin' then raise exception 'Not allowed to delete this' using errcode = '42501'; end if;
  perform _lock_accounts(array(select id from wallet_accounts where card_id = r.card_id));
  delete from card_transactions where id = p_id;
  perform _settle();
end $$;

-- ------------------------------------------------------------------ limits --
-- Start of the current week (Monday) or month in Asia/Beirut time
create function period_start(p_period text) returns timestamptz
language sql stable set search_path = public as $$
  select (date_trunc(case p_period when 'weekly' then 'week' when 'monthly' then 'month'
                     else null end, now() at time zone 'Asia/Beirut')) at time zone 'Asia/Beirut'
$$;

-- Net USD spent (expenses + card spending) for the family / a member / a category
create function period_spend(p_family_id uuid, p_member_id uuid default null, p_category_id uuid default null,
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
     where p_category_id is null and family_id = p_family_id and (p_member_id is null or member_id = p_member_id)
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ) s;
  return v;
end $$;

-- ------------------------------------------------------------------ grants --
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in
             ('create_expense','update_expense','delete_expense','create_deposit','delete_deposit',
              'create_transfer','delete_transfer','create_exchange','delete_exchange','create_card',
              'create_card_spend','delete_card_spend','period_start','period_spend')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_caller','_is_admin','_lock_accounts','_member_acct','_net_usd','_write_legs','_check_rate')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

commit;
