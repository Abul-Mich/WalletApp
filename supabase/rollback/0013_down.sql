-- 0013_down.sql: remove pockets. Refuses while any pocket holds money or has transfer history
-- (move the money back to the main wallets and delete those transfers first; pocket history is not kept).
begin;
do $$ begin
  if exists (select 1 from wallet_accounts where owner_kind = 'pocket' and balance_cache <> 0) then
    raise exception 'A pocket still holds money; move it back to the main wallets first'; end if;
  if exists (select 1 from transfers t join wallet_accounts a on a.id in (t.from_account_id, t.to_account_id) where a.owner_kind = 'pocket') then
    raise exception 'Pocket transfers exist; delete them (newest first) before rolling back'; end if;
end $$;

-- Transfers back to the 0009 rules.
create or replace function create_transfer(p_from uuid, p_to uuid, p_amount numeric, p_note text default null,
                                p_created_at timestamptz default null,
                                p_tagged_member_id uuid default null) returns transfers
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
       or (f.owner_kind = 'pool'   and t.owner_kind = 'card')
       or (f.owner_kind = 'member' and t.owner_kind = 'card'   and f.member_id = c.id)
       or (f.owner_kind = 'card'   and t.owner_kind = 'member' and t.member_id = c.id);
  if not ok then raise exception 'You are not allowed to move money between these wallets' using errcode = '42501'; end if;
  if p_tagged_member_id is not null and t.owner_kind = 'card' then
    if not exists (select 1 from members where id = p_tagged_member_id and family_id = f.family_id and removed_at is null) then
      raise exception 'The tagged member is not part of this family'; end if;
  else
    p_tagged_member_id := null;       -- tags are a label on card top-ups only
  end if;
  perform _lock_accounts(array[p_from, p_to]);
  insert into transfers (family_id, from_account_id, to_account_id, amount, created_by, note, created_at, tagged_member_id)
  values (f.family_id, p_from, p_to, p_amount, c.id, nullif(btrim(p_note),''), v_when, p_tagged_member_id) returning * into r;
  insert into wallet_entries (account_id, amount, created_at, transfer_id) values (p_from, -p_amount, v_when, r.id);
  insert into wallet_entries (account_id, amount, created_at, transfer_id) values (p_to,    p_amount, v_when, r.id);

  if f.owner_kind = 'pool' and t.owner_kind = 'member' then
    insert into notifications (family_id, type, member_id, amount) values (f.family_id, 'member_topup', t.member_id, p_amount);
  elsif f.owner_kind = 'member' and t.owner_kind = 'pool' then
    insert into notifications (family_id, type, member_id, amount) values (f.family_id, 'member_return', f.member_id, p_amount);
  elsif f.owner_kind = 'card' and t.owner_kind = 'member' then
    insert into notifications (family_id, type, member_id, card_id, amount) values (f.family_id, 'card_to_wallet', t.member_id, f.card_id, p_amount);
  elsif t.owner_kind = 'card' and f.owner_kind in ('pool','member') then
    insert into notifications (family_id, type, member_id, card_id, amount) values (f.family_id, 'card_topup', c.id, t.card_id, p_amount);
  end if;
  perform _settle();
  return r;
end $$;

-- Deposits back to the 0003 rules.
create or replace function create_deposit(p_account_id uuid, p_amount numeric, p_lbp_per_usd numeric default null,
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

-- Exchanges back to the 0003 rules.
create or replace function create_exchange(p_from uuid, p_to uuid, p_amount_from numeric, p_amount_to numeric,
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


drop function if exists create_pocket(uuid, text, text, text, numeric);
drop function if exists rename_pocket(uuid, text, text);
drop function if exists set_pocket_archived(uuid, boolean);

drop policy if exists transfers_select on transfers;
create policy transfers_select on transfers for select using (family_id in (select my_family_ids()));
drop policy if exists wallet_accounts_select on wallet_accounts;
create policy wallet_accounts_select on wallet_accounts for select using (family_id in (select my_family_ids()));

delete from wallet_accounts where owner_kind = 'pocket';
drop index if exists wallet_accounts_pocket_uq;
alter table wallet_accounts drop constraint wallet_accounts_check;
alter table wallet_accounts drop constraint wallet_accounts_owner_kind_check;
alter table wallet_accounts drop column pocket_id;
alter table wallet_accounts add constraint wallet_accounts_owner_kind_check check (owner_kind in ('pool','member','card'));
alter table wallet_accounts add constraint wallet_accounts_check check (
  (owner_kind = 'pool'   and member_id is null     and card_id is null) or
  (owner_kind = 'member' and member_id is not null and card_id is null) or
  (owner_kind = 'card'   and member_id is null     and card_id is not null)
);
drop table pockets;
commit;
