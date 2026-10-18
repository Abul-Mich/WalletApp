-- ============================================================================
-- 0012 · Edit card spending and common expenses
--  * update_card_spend:    amount, rate, category, person it is for, date, note (the card itself cannot change).
--  * update_common_expense: title, amount, currency, rate, category, person, date, note and the wallet it is paid from.
--  * Who may edit: card spending, the person who logged it or any admin; common expenses, admins.
--  * Each edit rewrites the record AND its ledger entry in one step, so balances, limits and statistics follow.
--    Nothing is saved if the new numbers would take a wallet below zero.
--  * Needs 0006, 0007 and 0010. Rollback: rollback/0012_down.sql (drops the two functions only).
-- ============================================================================
begin;

create function update_card_spend(
  p_id uuid, p_amount numeric, p_note text default null, p_lbp_per_usd numeric default null,
  p_created_at timestamptz default null, p_tagged_member_id uuid default null, p_category_id uuid default null
) returns card_transactions
language plpgsql security definer set search_path = public as $$
declare r card_transactions; k cards; a wallet_accounts; c members; v_when timestamptz; v_net numeric; v_tag uuid;
        v_old_rate numeric; v_rate numeric;
begin
  select * into r from card_transactions where id = p_id for update;
  if not found then raise exception 'Card spending not found'; end if;
  c := _caller(r.family_id);
  if c.id <> r.member_id and not _is_admin(c) then raise exception 'You can only edit your own card spending' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  select * into k from cards where id = r.card_id;
  if k.archived then raise exception 'This card is archived. Unarchive it to edit its spending'; end if;
  select * into a from wallet_accounts where card_id = k.id;

  v_tag := coalesce(p_tagged_member_id, r.tagged_member_id, r.member_id);
  if v_tag is distinct from coalesce(r.tagged_member_id, r.member_id)
     and not exists (select 1 from members where id = v_tag and family_id = r.family_id and removed_at is null) then
    raise exception 'The tagged member is not part of this family'; end if;
  if p_category_id is not null and not exists (select 1 from categories where id = p_category_id and family_id = r.family_id) then
    raise exception 'Category not found'; end if;

  if a.currency = 'USD' then
    v_net := p_amount; v_rate := null;
  else
    v_old_rate := case when r.net_usd > 0 then r.amount / r.net_usd end;      -- LBP per USD it was recorded at
    v_rate := coalesce(p_lbp_per_usd, v_old_rate);
    if v_rate is null then raise exception 'Enter the exchange rate'; end if;
    -- only re-check a rate that was actually changed
    if v_old_rate is null or abs(v_rate - v_old_rate) > 0.5 then perform _check_rate(r.family_id, v_rate, _is_admin(c)); end if;
    v_net := round(p_amount / v_rate, 4);
  end if;
  v_when := coalesce(p_created_at, r.created_at);

  perform _lock_accounts(array[a.id]);
  update card_transactions set amount = p_amount, exchange_rate_to_base = v_net / p_amount, net_usd = v_net,
         note = nullif(btrim(p_note),''), created_at = v_when, tagged_member_id = v_tag, category_id = p_category_id
   where id = r.id returning * into r;
  update wallet_entries set amount = -p_amount, created_at = v_when where card_txn_id = r.id;
  perform _settle();
  return r;
end $$;

create function update_common_expense(
  p_id uuid, p_title text, p_amount numeric, p_currency text, p_category_id uuid default null,
  p_lbp_per_usd numeric default null, p_note text default null, p_tagged_member_id uuid default null,
  p_created_at timestamptz default null, p_account_id uuid default null
) returns common_expenses
language plpgsql security definer set search_path = public as $$
declare r common_expenses; c members; a wallet_accounts; k cards; v_net numeric; v_rate numeric; v_old_rate numeric; v_when timestamptz;
begin
  select * into r from common_expenses where id = p_id for update;
  if not found then raise exception 'Common expense not found'; end if;
  c := _caller(r.family_id);
  if not _is_admin(c) then raise exception 'Only admins can edit common expenses' using errcode = '42501'; end if;
  if nullif(btrim(p_title),'') is null then raise exception 'A common expense needs a title'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if p_currency not in ('USD','LBP') then raise exception 'Common expenses are paid in USD or LBP'; end if;
  if p_category_id is not null and not exists (select 1 from categories where id = p_category_id and family_id = r.family_id) then
    raise exception 'Category not found'; end if;
  if p_tagged_member_id is distinct from r.tagged_member_id and p_tagged_member_id is not null
     and not exists (select 1 from members where id = p_tagged_member_id and family_id = r.family_id and removed_at is null) then
    raise exception 'The tagged member is not part of this family'; end if;

  if p_currency = 'USD' then
    v_net := p_amount; v_rate := null;
  else
    v_old_rate := r.lbp_per_usd;
    v_rate := coalesce(p_lbp_per_usd, v_old_rate);
    if v_rate is null then raise exception 'Enter the exchange rate'; end if;
    perform _check_rate(r.family_id, v_rate, true);
    v_net := round(p_amount / v_rate, 4);
  end if;
  if v_net < 0.01 then raise exception 'Amount is too small'; end if;

  -- where the money comes from: empty = the family pool in this currency (as when recording)
  if p_account_id is null then
    select * into a from wallet_accounts where family_id = r.family_id and owner_kind = 'pool' and currency = p_currency;
    if not found then raise exception 'Family pool wallet not found'; end if;
  else
    select * into a from wallet_accounts where id = p_account_id and family_id = r.family_id and owner_kind = 'card';
    if not found then raise exception 'That card or wallet was not found in this family'; end if;
    select * into k from cards where id = a.card_id;
    if k.archived and a.id <> r.account_id then raise exception 'This card is archived and can no longer be used'; end if;
    if a.currency <> p_currency then raise exception 'This card holds % but the expense is in %', a.currency, p_currency; end if;
  end if;
  v_when := coalesce(p_created_at, r.created_at);

  perform _lock_accounts(array[r.account_id, a.id]);
  update common_expenses set title = btrim(p_title), amount = p_amount, currency = p_currency, lbp_per_usd = v_rate,
         net_usd = v_net, category_id = p_category_id, tagged_member_id = p_tagged_member_id,
         account_id = a.id, note = nullif(btrim(p_note),''), created_at = v_when
   where id = r.id returning * into r;
  update wallet_entries set account_id = a.id, amount = -p_amount, created_at = v_when where common_expense_id = r.id;
  perform _settle();
  return r;
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('update_card_spend','update_common_expense')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

commit;
