-- ============================================================================
-- 0001 · Two-wallet ledger: schema only (ADDITIVE — nothing existing changes
--        except new nullable columns). Safe to run while the app is live.
-- Run in one go in the Supabase SQL editor. Rollback: rollback/0001_down.sql
-- ============================================================================
begin;

-- ---- accounts: one per holder (family pool / member / card) and currency ----
create table wallet_accounts (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references families(id) on delete cascade,
  owner_kind    text not null check (owner_kind in ('pool','member','card')),
  member_id     uuid references members(id) on delete cascade,
  card_id       uuid references cards(id)   on delete cascade,
  currency      text not null check (currency in ('USD','LBP')),
  balance_cache numeric not null default 0,
  created_at    timestamptz not null default now(),
  check (
    (owner_kind = 'pool'   and member_id is null     and card_id is null) or
    (owner_kind = 'member' and member_id is not null and card_id is null) or
    (owner_kind = 'card'   and member_id is null     and card_id is not null)
  )
);
create unique index wallet_accounts_pool_uq   on wallet_accounts (family_id, currency) where owner_kind = 'pool';
create unique index wallet_accounts_member_uq on wallet_accounts (member_id, currency) where owner_kind = 'member';
create unique index wallet_accounts_card_uq   on wallet_accounts (card_id)             where owner_kind = 'card';  -- one currency per card
create index wallet_accounts_family_idx on wallet_accounts (family_id);

-- ---- new record types ----
create table transfers (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references families(id) on delete cascade,
  from_account_id  uuid not null references wallet_accounts(id),
  to_account_id    uuid not null references wallet_accounts(id),
  amount           numeric not null check (amount > 0),
  created_by       uuid references members(id) on delete set null,
  note             text,
  legacy_table     text,          -- set by the backfill only (traceability)
  legacy_id        uuid,
  created_at       timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index transfers_family_idx on transfers (family_id, created_at desc);

create table exchanges (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references families(id) on delete cascade,
  from_account_id  uuid not null references wallet_accounts(id),
  to_account_id    uuid not null references wallet_accounts(id),
  amount_from      numeric not null check (amount_from > 0),
  amount_to        numeric not null check (amount_to   > 0),
  lbp_per_usd      numeric not null check (lbp_per_usd > 0),
  created_by       uuid references members(id) on delete set null,
  created_at       timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);
create index exchanges_family_idx on exchanges (family_id, created_at desc);

-- A visible, labelled opening correction (see design doc OD6)
create table opening_entries (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  account_id  uuid not null references wallet_accounts(id),
  amount      numeric not null check (amount <> 0),
  note        text not null,
  created_at  timestamptz not null default now()
);

-- ---- new columns on existing tables (all nullable / defaulted) ----
alter table transactions      add column net_usd     numeric;   -- authoritative USD value of the expense
alter table transactions      add column lbp_per_usd numeric;   -- rate used for the LBP part (null if USD only)
alter table card_transactions add column net_usd     numeric;   -- card spending counts toward limits (D20)
alter table deposits          add column account_id  uuid references wallet_accounts(id);
alter table members           add column removed_at  timestamptz;  -- soft removal keeps history (D-removal)

create table transaction_legs (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references transactions(id) on delete cascade,
  account_id      uuid not null references wallet_accounts(id),
  amount          numeric not null check (amount <> 0),   -- negative = paid, positive = change
  created_at      timestamptz not null default now()
);
create index transaction_legs_txn_idx on transaction_legs (transaction_id);

-- ---- the ledger: signed entries, exactly one source each ----
create table wallet_entries (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references wallet_accounts(id) on delete cascade,
  amount         numeric not null check (amount <> 0),     -- in the account's currency
  created_at     timestamptz not null default now(),
  deposit_id     uuid references deposits(id)                   on delete cascade,
  adjustment_id  uuid references wallet_balance_adjustments(id) on delete cascade,
  opening_id     uuid references opening_entries(id)            on delete cascade,
  transfer_id    uuid references transfers(id)                  on delete cascade,
  exchange_id    uuid references exchanges(id)                  on delete cascade,
  leg_id         uuid references transaction_legs(id)           on delete cascade,
  card_txn_id    uuid references card_transactions(id)          on delete cascade,
  check (num_nonnulls(deposit_id, adjustment_id, opening_id, transfer_id, exchange_id, leg_id, card_txn_id) = 1)
);
create index wallet_entries_account_idx on wallet_entries (account_id, created_at desc);
create index wallet_entries_transfer_idx on wallet_entries (transfer_id)  where transfer_id is not null;
create index wallet_entries_exchange_idx on wallet_entries (exchange_id)  where exchange_id is not null;
create index wallet_entries_leg_idx      on wallet_entries (leg_id)       where leg_id is not null;

-- ---- balance_cache maintenance + non-negative rule ----
create function wallet_entries_recalc() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- Lock the account row FIRST, then sum in a separate statement: a concurrent
  -- change that commits while we wait is then included (no lost updates).
  for v_id in
    select distinct x from unnest(array[
      case when tg_op in ('UPDATE','DELETE') then old.account_id end,
      case when tg_op in ('INSERT','UPDATE') then new.account_id end]) x
    where x is not null
    order by 1
  loop
    perform 1 from wallet_accounts where id = v_id for update;
    update wallet_accounts a set balance_cache =
      (select coalesce(sum(e.amount),0) from wallet_entries e where e.account_id = a.id)
    where a.id = v_id;
  end loop;
  return null;
end $$;

create trigger trg_wallet_entries_recalc
  after insert or update or delete on wallet_entries
  for each row execute function wallet_entries_recalc();

-- Deferred: judged on the final state of the transaction, so an edit that
-- removes and re-adds legs is not rejected halfway through.
create function wallet_entries_nonneg() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_bal numeric; v_name text;
begin
  v_id := coalesce(new.account_id, old.account_id);
  select a.balance_cache,
         a.owner_kind || ' ' || a.currency
    into v_bal, v_name
    from wallet_accounts a where a.id = v_id;
  if found and v_bal < 0 then
    raise exception 'Not enough balance in the % wallet (short by %)', v_name, round(-v_bal, 4)
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger trg_wallet_entries_nonneg
  after insert or update or delete on wallet_entries
  deferrable initially deferred
  for each row execute function wallet_entries_nonneg();

-- Called at the end of every money function so a shortfall is reported there,
-- with a readable message, instead of only when the request commits.
create function _settle() returns void
language plpgsql as $$
begin
  execute 'set constraints trg_wallet_entries_nonneg immediate';
  execute 'set constraints trg_wallet_entries_nonneg deferred';
end $$;
revoke all on function _settle() from public, anon, authenticated;

-- ---- RLS: read same-family; no direct writes (functions write) ----
alter table wallet_accounts   enable row level security;
alter table wallet_entries    enable row level security;
alter table transfers         enable row level security;
alter table exchanges         enable row level security;
alter table transaction_legs  enable row level security;
alter table opening_entries   enable row level security;

create policy wallet_accounts_select on wallet_accounts for select using (family_id in (select my_family_ids()));
create policy transfers_select       on transfers       for select using (family_id in (select my_family_ids()));
create policy exchanges_select       on exchanges       for select using (family_id in (select my_family_ids()));
create policy opening_entries_select on opening_entries for select using (family_id in (select my_family_ids()));
create policy wallet_entries_select  on wallet_entries
  for select using (account_id in (select id from wallet_accounts where family_id in (select my_family_ids())));
create policy transaction_legs_select on transaction_legs
  for select using (transaction_id in (select id from transactions where family_id in (select my_family_ids())));

revoke all on wallet_accounts, wallet_entries, transfers, exchanges, transaction_legs, opening_entries from anon, authenticated;
grant select on wallet_accounts, wallet_entries, transfers, exchanges, transaction_legs, opening_entries to authenticated;

commit;
