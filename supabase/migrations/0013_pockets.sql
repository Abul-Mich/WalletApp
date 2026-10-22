-- ============================================================================
-- 0013 · Pockets: named savings buckets carved out of a member's own money.
--  * A pocket is a new kind of ledger account ('pocket'), one currency, owned by one member.
--    It is held in the new `pockets` table (name, colour, archived) plus one wallet_accounts row.
--  * Money only moves between a member's own MAIN wallet and their own pockets (a plain transfer;
--    nothing is created or lost). Spending still comes only from the main wallet.
--  * Pockets are private to their owner and to admins (RLS). Other members cannot see them or the
--    transfers into and out of them.
--  * Pockets cannot be exchanged, cannot receive deposits, and must be empty to be archived.
--  * remove_member already refuses while a member holds money in ANY of their accounts, so it covers pockets.
--  * No existing rows change. No notifications are written for pocket moves (they are personal).
-- Needs 0001-0012. Rollback: rollback/0013_down.sql (refuses while a pocket holds money).
-- ============================================================================
begin;

-- --------------------------------------------------------------- pockets --
create table pockets (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  member_id   uuid not null references members(id)  on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  color       text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index pockets_name_uq   on pockets (member_id, lower(btrim(name))) where not archived;
create index        pockets_member_ix on pockets (member_id);

alter table pockets enable row level security;
create policy pockets_select on pockets for select using (
  family_id in (select my_family_ids())
  and (is_admin(family_id)
       or member_id in (select m.id from members m where m.user_id = auth.uid() and m.removed_at is null))
);
revoke all on pockets from anon, authenticated;
grant select on pockets to authenticated;

-- ------------------------------------------------- the pocket account kind --
alter table wallet_accounts add column pocket_id uuid references pockets(id) on delete cascade;

alter table wallet_accounts drop constraint if exists wallet_accounts_owner_kind_check;
alter table wallet_accounts drop constraint if exists wallet_accounts_check;
alter table wallet_accounts add constraint wallet_accounts_owner_kind_check
  check (owner_kind in ('pool','member','card','pocket'));
alter table wallet_accounts add constraint wallet_accounts_check check (
  (owner_kind = 'pool'   and member_id is null     and card_id is null     and pocket_id is null) or
  (owner_kind = 'member' and member_id is not null and card_id is null     and pocket_id is null) or
  (owner_kind = 'card'   and member_id is null     and card_id is not null and pocket_id is null) or
  (owner_kind = 'pocket' and member_id is not null and card_id is null     and pocket_id is not null)
);
create unique index wallet_accounts_pocket_uq on wallet_accounts (pocket_id) where owner_kind = 'pocket';

-- ----------------------------------------------------------- visibility --
-- A pocket account is visible to its owner and to admins; everything else is visible to the family, as before.
drop policy if exists wallet_accounts_select on wallet_accounts;
create policy wallet_accounts_select on wallet_accounts for select using (
  family_id in (select my_family_ids())
  and (owner_kind <> 'pocket'
       or is_admin(family_id)
       or member_id in (select m.id from members m where m.user_id = auth.uid() and m.removed_at is null))
);
-- A transfer is visible only if both of its accounts are visible to the reader.
drop policy if exists transfers_select on transfers;
create policy transfers_select on transfers for select using (
  family_id in (select my_family_ids())
  and (select count(*) from wallet_accounts a where a.id in (from_account_id, to_account_id)) = 2
);
-- wallet_entries_select already goes through wallet_accounts, so it follows the policy above.

-- ------------------------------------------------------------- functions --
create function create_pocket(p_family_id uuid, p_name text, p_currency text,
                              p_color text default null, p_start_amount numeric default null) returns pockets
language plpgsql security definer set search_path = public as $$
declare c members; p pockets; v_acct uuid; v_main uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  c := _caller(p_family_id);
  if v_name = '' then raise exception 'A pocket needs a name'; end if;
  if char_length(v_name) > 40 then raise exception 'Pocket names are limited to 40 characters'; end if;
  if p_currency is null or p_currency not in ('USD','LBP') then raise exception 'A pocket holds USD or LBP'; end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Choose a colour from the list'; end if;
  if p_start_amount is not null and p_start_amount < 0 then raise exception 'The starting amount cannot be negative'; end if;
  if (select count(*) from pockets where member_id = c.id and not archived) >= 20 then
    raise exception 'You can have up to 20 pockets'; end if;
  if exists (select 1 from pockets where member_id = c.id and not archived and lower(btrim(name)) = lower(v_name)) then
    raise exception 'You already have a pocket with this name'; end if;
  insert into pockets (family_id, member_id, name, color) values (p_family_id, c.id, v_name, p_color) returning * into p;
  insert into wallet_accounts (family_id, owner_kind, member_id, pocket_id, currency)
  values (p_family_id, 'pocket', c.id, p.id, p_currency) returning id into v_acct;
  if p_start_amount is not null and p_start_amount > 0 then
    v_main := _member_acct(c.id, p_currency);
    perform create_transfer(v_main, v_acct, p_start_amount, 'Moved into ' || v_name);
  end if;
  return p;
end $$;

create function rename_pocket(p_id uuid, p_name text, p_color text default null) returns pockets
language plpgsql security definer set search_path = public as $$
declare p pockets; c members; v_name text := btrim(coalesce(p_name, ''));
begin
  select * into p from pockets where id = p_id for update;
  if not found then raise exception 'Pocket not found'; end if;
  c := _caller(p.family_id);
  if p.member_id <> c.id then raise exception 'Only the owner can change a pocket' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'A pocket needs a name'; end if;
  if char_length(v_name) > 40 then raise exception 'Pocket names are limited to 40 characters'; end if;
  if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Choose a colour from the list'; end if;
  if exists (select 1 from pockets where member_id = c.id and not archived and id <> p.id and lower(btrim(name)) = lower(v_name)) then
    raise exception 'You already have a pocket with this name'; end if;
  update pockets set name = v_name, color = coalesce(p_color, color) where id = p.id returning * into p;
  return p;
end $$;

create function set_pocket_archived(p_id uuid, p_archived boolean) returns pockets
language plpgsql security definer set search_path = public as $$
declare p pockets; c members; a wallet_accounts;
begin
  select * into p from pockets where id = p_id for update;
  if not found then raise exception 'Pocket not found'; end if;
  c := _caller(p.family_id);
  if p.member_id <> c.id then raise exception 'Only the owner can change a pocket' using errcode = '42501'; end if;
  select * into a from wallet_accounts where pocket_id = p.id for update;
  if p_archived then
    if a.balance_cache <> 0 then raise exception 'Move the money out of this pocket first'; end if;
  else
    if (select count(*) from pockets where member_id = c.id and not archived) >= 20 then
      raise exception 'You can have up to 20 pockets'; end if;
    if exists (select 1 from pockets where member_id = c.id and not archived and id <> p.id and lower(btrim(name)) = lower(p.name)) then
      raise exception 'You already have a pocket with this name'; end if;
  end if;
  update pockets set archived = p_archived where id = p.id returning * into p;
  return p;
end $$;

-- Transfers: same as 0009, plus the pocket rule (own main wallet <-> own pocket only; admins get no exception).
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
  if f.owner_kind = 'pocket' or t.owner_kind = 'pocket' then
    if not ((f.owner_kind = 'member' and t.owner_kind = 'pocket' and f.member_id = c.id and t.member_id = c.id)
         or (f.owner_kind = 'pocket' and t.owner_kind = 'member' and f.member_id = c.id and t.member_id = c.id)) then
      raise exception 'A pocket only exchanges money with your own main wallet' using errcode = '42501'; end if;
    if (select archived from pockets where id = coalesce(f.pocket_id, t.pocket_id)) then
      raise exception 'This pocket is archived'; end if;
    ok := true;
  else
    ok := _is_admin(c)
       or (f.owner_kind = 'pool'   and t.owner_kind = 'member' and t.member_id = c.id)
       or (f.owner_kind = 'member' and t.owner_kind = 'pool'   and f.member_id = c.id)
       or (f.owner_kind = 'pool'   and t.owner_kind = 'card')
       or (f.owner_kind = 'member' and t.owner_kind = 'card'   and f.member_id = c.id)
       or (f.owner_kind = 'card'   and t.owner_kind = 'member' and t.member_id = c.id);
  end if;
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

-- Deposits: same as 0003, but a pocket cannot receive one (outside money into a pocket comes later).
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
  if a.owner_kind = 'pocket' then raise exception 'Money cannot be added to a pocket directly; move it from the main wallet'; end if;
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

-- Exchanges: same as 0003, but pockets cannot be exchanged (exchange in the main wallets).
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
  if f.owner_kind = 'pocket' then raise exception 'Pockets cannot exchange currencies; exchange in your main wallet'; end if;
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

-- ------------------------------------------------------------ permissions --
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_pocket','rename_pocket','set_pocket_archived','create_transfer','create_deposit','create_exchange')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

commit;
