-- Family Wallet App — Full Schema (Days 1-5 + Planned Payments + Roles/Budgets redesign)
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New Query)
-- Safe to re-run: drops existing policies/triggers before recreating them.
-- NOTE: table/column additions use "if not exists" so this is also safe to run
-- as an upgrade on top of an earlier version of this schema.

-- ============================================================
-- 0. EXTENSIONS
-- ============================================================
create extension if not exists "uuid-ossp";

-- ============================================================
-- 1. TABLES
-- ============================================================

create table if not exists families (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  base_currency text not null default 'USD',
  -- Family Budget: a target the admin sets for the period, separate from the
  -- actual cash balance (wallets.balance_cache). "Budget used" is computed
  -- from transactions the same way member limits are, just at family scope.
  budget_amount numeric,
  budget_period text check (budget_period in ('weekly', 'monthly')),
  created_at timestamptz not null default now()
);
alter table families add column if not exists budget_amount numeric;
alter table families add column if not exists budget_period text;

create table if not exists members (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('superadmin', 'admin', 'member')) default 'member',
  spending_limit_amount numeric,
  spending_limit_period text check (spending_limit_period in ('weekly', 'monthly')),
  preferred_currency text not null default 'USD',
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);
-- Migration: on a database created before 'superadmin' existed, the CHECK
-- constraint above was never applied (CREATE TABLE IF NOT EXISTS skips
-- table/constraint definitions entirely if the table already exists). Fix
-- it here so re-running this script also repairs older databases.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'members_role_check'
      and conrelid = 'members'::regclass
      and pg_get_constraintdef(oid) not like '%superadmin%'
  ) then
    alter table members drop constraint members_role_check;
    alter table members add constraint members_role_check
      check (role in ('superadmin', 'admin', 'member'));
  end if;
end $$;

create table if not exists wallets (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null unique references families(id) on delete cascade,
  balance_cache numeric not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  -- Category Budget: independent cap/target for this category, unrelated to
  -- any member's personal spending limit (two separate tracked totals).
  budget_amount numeric,
  budget_period text check (budget_period in ('weekly', 'monthly'))
);
alter table categories add column if not exists budget_amount numeric;
alter table categories add column if not exists budget_period text;

create table if not exists deposits (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  added_by_member_id uuid not null references members(id) on delete cascade,
  amount numeric not null check (amount > 0),
  currency text not null,
  exchange_rate_to_base numeric not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  amount numeric not null check (amount > 0),
  currency text not null,
  exchange_rate_to_base numeric not null default 1,
  category_id uuid references categories(id),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists exchange_rate_overrides (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  currency_pair text not null,
  rate numeric not null,
  set_by_member_id uuid not null references members(id),
  effective_date date not null default current_date
);

-- Invite links: lets an admin generate a shareable join code (FR3)
create table if not exists family_invites (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  code text not null unique,
  created_by_member_id uuid not null references members(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz
);

-- Planned payments / recurring bills. Any family member can add a bill;
-- only the creator or an admin/superadmin can edit/delete it.
create table if not exists planned_payments (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  created_by_member_id uuid not null references members(id) on delete cascade,
  name text not null,
  amount numeric not null check (amount > 0),
  currency text not null,
  exchange_rate_to_base numeric not null default 1,
  category_id uuid references categories(id),
  recurrence text not null check (recurrence in ('one_time', 'weekly', 'monthly')) default 'monthly',
  next_due_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Per-member live balance: an amount allocated to a member out of the
-- family's shared cash (wallets.balance_cache), separate from the
-- spending_limit_amount threshold above. Only ever changed by the
-- recalc_member_balance() trigger function below — never written to
-- directly by the app (enforced by trg_prevent_balance_tampering).
alter table members add column if not exists balance numeric not null default 0;

-- Records a member moving money from the shared family balance into their
-- own live balance (self-serve; always immediate, no approval step).
-- amount is stored in `currency`, already converted to the family's base
-- currency via exchange_rate_to_base for all balance math (mirrors how
-- deposits/transactions store multi-currency amounts).
-- amount > 0  => member withdrawing from the shared family balance into
--                their own held balance
-- amount < 0  => member returning held cash back into the shared balance
create table if not exists member_balance_transfers (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  amount numeric not null check (amount <> 0),
  currency text not null default 'USD',
  exchange_rate_to_base numeric not null default 1,
  created_at timestamptz not null default now()
);
alter table member_balance_transfers add column if not exists currency text not null default 'USD';
alter table member_balance_transfers add column if not exists exchange_rate_to_base numeric not null default 1;
-- Migration: older databases created this table before returns-to-main were
-- supported, with a stricter "amount > 0" check. Loosen it here so
-- re-running this script also upgrades existing databases.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'member_balance_transfers_amount_check'
      and conrelid = 'member_balance_transfers'::regclass
      and pg_get_constraintdef(oid) like '%> 0%'
  ) then
    alter table member_balance_transfers drop constraint member_balance_transfers_amount_check;
    alter table member_balance_transfers add constraint member_balance_transfers_amount_check
      check (amount <> 0);
  end if;
end $$;

-- Lightweight in-app notification log. Currently only used to tell
-- admins/superadmins when a member tops up their own balance, but kept
-- general (a "type" column) in case other notification kinds are added.
create table if not exists notifications (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  type text not null,
  member_id uuid references members(id) on delete cascade,
  amount numeric,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. HELPER FUNCTIONS (avoid recursive RLS lookups)
-- ============================================================
-- Returns the family_id(s) the current auth user belongs to.
create or replace function my_family_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select family_id from members where user_id = auth.uid();
$$;

create or replace function my_role_in(fam_id uuid)
returns text
language sql
security definer
stable
as $$
  select role from members where user_id = auth.uid() and family_id = fam_id limit 1;
$$;

-- True for both 'admin' and 'superadmin' — most policies just need "is this
-- person allowed to manage family settings," not which admin tier exactly.
create or replace function is_admin(fam_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select my_role_in(fam_id) in ('admin', 'superadmin');
$$;

create or replace function is_superadmin(fam_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select my_role_in(fam_id) = 'superadmin';
$$;

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================
alter table families enable row level security;
alter table members enable row level security;
alter table wallets enable row level security;
alter table categories enable row level security;
alter table deposits enable row level security;
alter table transactions enable row level security;
alter table exchange_rate_overrides enable row level security;
alter table family_invites enable row level security;
alter table planned_payments enable row level security;
alter table member_balance_transfers enable row level security;
alter table notifications enable row level security;

-- families: readable/writable only if you're a member of it
drop policy if exists "families_select" on families;
create policy "families_select" on families
  for select using (id in (select my_family_ids()));

drop policy if exists "families_insert" on families;
create policy "families_insert" on families
  for insert with check (true); -- creator becomes 'superadmin' via app logic

drop policy if exists "families_update" on families;
create policy "families_update" on families
  for update using (is_admin(id));

-- Deleting a family is irreversible and cascades to every table referencing
-- family_id (members, wallets, transactions, cards, categories, ...), so
-- it's restricted to the superadmin — a regular admin can manage settings
-- but not erase the whole family's data.
drop policy if exists "families_delete_superadmin" on families;
create policy "families_delete_superadmin" on families
  for delete using (is_superadmin(id));

-- members: readable by anyone in the same family; writable by admins/self,
-- with role-change privilege escalation blocked by a trigger below (RLS
-- alone can't compare old vs. new column values on UPDATE).
drop policy if exists "members_select" on members;
create policy "members_select" on members
  for select using (family_id in (select my_family_ids()));

drop policy if exists "members_insert_self" on members;
create policy "members_insert_self" on members
  for insert with check (user_id = auth.uid());

drop policy if exists "members_update_admin" on members;
create policy "members_update_admin" on members
  for update using (is_admin(family_id) or user_id = auth.uid());

-- Only admins/superadmin can remove members, and a superadmin can never be
-- removed by anyone (prevents a family losing its only unremovable admin).
drop policy if exists "members_delete_admin" on members;
create policy "members_delete_admin" on members
  for delete using (is_admin(family_id) and role <> 'superadmin');

-- wallets: readable by family, writable by admins
drop policy if exists "wallets_select" on wallets;
create policy "wallets_select" on wallets
  for select using (family_id in (select my_family_ids()));

drop policy if exists "wallets_all_admin" on wallets;
create policy "wallets_all_admin" on wallets
  for all using (is_admin(family_id));

-- categories: readable by family; writable by admins only
drop policy if exists "categories_select" on categories;
create policy "categories_select" on categories
  for select using (family_id in (select my_family_ids()));

drop policy if exists "categories_admin_write" on categories;
create policy "categories_admin_write" on categories
  for insert with check (is_admin(family_id));

drop policy if exists "categories_admin_update" on categories;
create policy "categories_admin_update" on categories
  for update using (is_admin(family_id));

drop policy if exists "categories_admin_delete" on categories;
create policy "categories_admin_delete" on categories
  for delete using (is_admin(family_id));

-- deposits: readable by family; only admins can insert
drop policy if exists "deposits_select" on deposits;
create policy "deposits_select" on deposits
  for select using (family_id in (select my_family_ids()));

drop policy if exists "deposits_admin_insert" on deposits;
create policy "deposits_admin_insert" on deposits
  for insert with check (is_admin(family_id));

-- transactions: readable by family; any member can insert their own;
-- a member can edit/delete their own, admins can edit/delete anyone's (FR — full CRUD)
drop policy if exists "transactions_select" on transactions;
create policy "transactions_select" on transactions
  for select using (family_id in (select my_family_ids()));

drop policy if exists "transactions_insert_self" on transactions;
create policy "transactions_insert_self" on transactions
  for insert with check (
    family_id in (select my_family_ids())
    and member_id in (select id from members where user_id = auth.uid())
  );

drop policy if exists "transactions_update_own_or_admin" on transactions;
create policy "transactions_update_own_or_admin" on transactions
  for update using (
    member_id in (select id from members where user_id = auth.uid())
    or is_admin(family_id)
  );

drop policy if exists "transactions_delete_own_or_admin" on transactions;
create policy "transactions_delete_own_or_admin" on transactions
  for delete using (
    member_id in (select id from members where user_id = auth.uid())
    or is_admin(family_id)
  );

-- exchange_rate_overrides: readable by family; only admins can insert
drop policy if exists "rate_overrides_select" on exchange_rate_overrides;
create policy "rate_overrides_select" on exchange_rate_overrides
  for select using (family_id in (select my_family_ids()));

drop policy if exists "rate_overrides_admin_insert" on exchange_rate_overrides;
create policy "rate_overrides_admin_insert" on exchange_rate_overrides
  for insert with check (is_admin(family_id));

-- family_invites: readable by family members (to see/share the code); only admins create
drop policy if exists "invites_select" on family_invites;
create policy "invites_select" on family_invites
  for select using (family_id in (select my_family_ids()));

drop policy if exists "invites_admin_insert" on family_invites;
create policy "invites_admin_insert" on family_invites
  for insert with check (is_admin(family_id));

-- Public/limited lookup for join-by-code: allow any authenticated user to look up
-- an invite row by code alone (needed before they're a member of the family).
drop policy if exists "invites_lookup_by_code" on family_invites;
create policy "invites_lookup_by_code" on family_invites
  for select using (auth.uid() is not null);

-- planned_payments: readable by family; any member can create; only the
-- creator or an admin can edit/delete
drop policy if exists "planned_payments_select" on planned_payments;
create policy "planned_payments_select" on planned_payments
  for select using (family_id in (select my_family_ids()));

drop policy if exists "planned_payments_insert" on planned_payments;
create policy "planned_payments_insert" on planned_payments
  for insert with check (
    family_id in (select my_family_ids())
    and created_by_member_id in (select id from members where user_id = auth.uid())
  );

drop policy if exists "planned_payments_update" on planned_payments;
create policy "planned_payments_update" on planned_payments
  for update using (
    created_by_member_id in (select id from members where user_id = auth.uid())
    or is_admin(family_id)
  );

drop policy if exists "planned_payments_delete" on planned_payments;
create policy "planned_payments_delete" on planned_payments
  for delete using (
    created_by_member_id in (select id from members where user_id = auth.uid())
    or is_admin(family_id)
  );

-- member_balance_transfers: readable by family; a member can only insert a
-- transfer into their OWN balance (self-serve top-up, no approval gate).
drop policy if exists "member_transfers_select" on member_balance_transfers;
create policy "member_transfers_select" on member_balance_transfers
  for select using (family_id in (select my_family_ids()));

drop policy if exists "member_transfers_insert_self" on member_balance_transfers;
create policy "member_transfers_insert_self" on member_balance_transfers
  for insert with check (
    family_id in (select my_family_ids())
    and member_id in (select id from members where user_id = auth.uid())
  );

-- Corrections (fixing a mistyped amount, removing a bad entry) are
-- superadmin/admin only — a self-serve top-up isn't something a member can
-- quietly edit after the fact.
drop policy if exists "member_transfers_update_admin" on member_balance_transfers;
create policy "member_transfers_update_admin" on member_balance_transfers
  for update using (is_admin(family_id));

drop policy if exists "member_transfers_delete_admin" on member_balance_transfers;
create policy "member_transfers_delete_admin" on member_balance_transfers
  for delete using (is_admin(family_id));

-- notifications: admins/superadmins only (that's who needs to see a member
-- topped up their balance). Rows are only ever written by the trigger below.
drop policy if exists "notifications_select_admin" on notifications;
create policy "notifications_select_admin" on notifications
  for select using (is_admin(family_id));

-- ============================================================
-- 4. TRIGGERS
-- ============================================================

-- 4a. Keep wallets.balance_cache in sync on any deposit/transaction change
-- (insert, update, or delete — this is what makes transaction editing and
-- deleting correctly reflect in the balance without extra app-side math).
create or replace function recalc_wallet_balance()
returns trigger
language plpgsql
security definer
as $$
declare
  fam_id uuid;
  total_deposits numeric;
  total_spent numeric;
begin
  fam_id := coalesce(new.family_id, old.family_id);

  select coalesce(sum(amount * exchange_rate_to_base), 0) into total_deposits
  from deposits where family_id = fam_id;

  select coalesce(sum(amount * exchange_rate_to_base), 0) into total_spent
  from transactions where family_id = fam_id;

  update wallets
    set balance_cache = total_deposits - total_spent,
        updated_at = now()
    where family_id = fam_id;

  return new;
end;
$$;

drop trigger if exists trg_deposits_recalc on deposits;
create trigger trg_deposits_recalc
  after insert or update or delete on deposits
  for each row execute function recalc_wallet_balance();

drop trigger if exists trg_transactions_recalc on transactions;
create trigger trg_transactions_recalc
  after insert or update or delete on transactions
  for each row execute function recalc_wallet_balance();

-- 4b. Block privilege escalation on members.role. RLS policies can only see
-- the NEW row on UPDATE ... WITH CHECK, not compare it against OLD, so this
-- has to be a trigger: without it, the existing "members_update_admin" policy
-- (which lets a user update their own row for things like display_name)
-- would also let a plain member silently promote themselves to admin.
create or replace function prevent_role_privilege_escalation()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.role is distinct from old.role then
    if new.role = 'superadmin' then
      -- Only allow this if the family doesn't already have a superadmin —
      -- this is what makes the one-time migration UPDATE (for families
      -- created before this role existed) work, while still blocking
      -- anyone from creating a second superadmin or hijacking the role.
      if exists (
        select 1 from members where family_id = old.family_id and role = 'superadmin'
      ) then
        raise exception 'this family already has a superadmin';
      end if;
    elsif old.role = 'superadmin' then
      -- An existing superadmin can never be demoted/changed by anyone.
      raise exception 'superadmin role cannot be changed once set';
    else
      -- Any other role change (member <-> admin) requires the acting user
      -- to already be an admin/superadmin of this family.
      if not is_admin(old.family_id) then
        raise exception 'only an admin can change a member''s role';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_role_escalation on members;
create trigger trg_prevent_role_escalation
  before update on members
  for each row execute function prevent_role_privilege_escalation();

-- 4c. members.balance is a derived value (transfers in minus that member's
-- own spending) — it must never be writable directly by the app/client, only
-- by recalc_member_balance() below. A BEFORE UPDATE trigger can't tell "the
-- app tried to change this" apart from "our own trusted function changed
-- this", so the trusted path flips a transaction-local flag immediately
-- before/after its update, and this trigger only allows the change through
-- while that flag is set.
create or replace function prevent_balance_tampering()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.balance is distinct from old.balance
     and coalesce(current_setting('app.allow_balance_update', true), 'off') <> 'on' then
    raise exception 'members.balance cannot be set directly — it is derived from transfers and transactions';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_balance_tampering on members;
create trigger trg_prevent_balance_tampering
  before update on members
  for each row execute function prevent_balance_tampering();

-- 4d. Recomputes one member's live balance from source tables (the same
-- "recompute from scratch" pattern as recalc_wallet_balance, so edits/
-- deletes to either side stay correct without incremental drift).
create or replace function recalc_member_balance(target_member_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  total_transfers numeric;
  total_spent numeric;
begin
  select coalesce(sum(amount * exchange_rate_to_base), 0) into total_transfers
  from member_balance_transfers where member_id = target_member_id;

  select coalesce(sum(amount * exchange_rate_to_base), 0) into total_spent
  from transactions where member_id = target_member_id;

  perform set_config('app.allow_balance_update', 'on', true);
  update members set balance = total_transfers - total_spent where id = target_member_id;
  perform set_config('app.allow_balance_update', 'off', true);
end;
$$;

create or replace function trg_fn_recalc_member_balance_on_txn()
returns trigger
language plpgsql
security definer
as $$
begin
  if TG_OP = 'DELETE' then
    perform recalc_member_balance(old.member_id);
    return old;
  end if;

  perform recalc_member_balance(new.member_id);
  if TG_OP = 'UPDATE' and old.member_id is distinct from new.member_id then
    perform recalc_member_balance(old.member_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transactions_recalc_member_balance on transactions;
create trigger trg_transactions_recalc_member_balance
  after insert or update or delete on transactions
  for each row execute function trg_fn_recalc_member_balance_on_txn();

-- 4f. Enforce that a member can only log an expense they can actually
-- afford out of their own balance — without this, "My Balance" is just a
-- number that gets displayed, not a real wallet with a spending limit.
-- Runs BEFORE insert/update (so it can block the write), compares against
-- the *change* in claim on the member's balance so editing an existing
-- transaction down (or to a different member) doesn't get double-counted.
create or replace function check_transaction_covers_balance()
returns trigger
language plpgsql
security definer
as $$
declare
  old_base_amount numeric;
  new_base_amount numeric;
  member_changed boolean;
  target_member_balance numeric;
  delta numeric;
begin
  new_base_amount := new.amount * new.exchange_rate_to_base;
  member_changed := TG_OP = 'UPDATE' and old.member_id is distinct from new.member_id;
  old_base_amount := case
    when TG_OP = 'UPDATE' and not member_changed then old.amount * old.exchange_rate_to_base
    else 0
  end;
  delta := new_base_amount - old_base_amount;

  if delta > 0 then
    select balance into target_member_balance from members where id = new.member_id;
    if delta > coalesce(target_member_balance, 0) then
      raise exception 'Not enough balance to log this expense (your balance: %)',
        round(coalesce(target_member_balance, 0), 2);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_transactions_check_balance on transactions;
create trigger trg_transactions_check_balance
  before insert or update on transactions
  for each row execute function check_transaction_covers_balance();

-- 4e. When a member tops up their own balance: check the family actually has
-- that much unallocated cash (wallet balance minus what's already allocated
-- to every member), recompute the member's balance, and notify admins.
-- Also handles admin corrections (UPDATE/DELETE) — those re-run the same
-- validation against the *change* in amount, then always recompute the
-- member's balance from scratch via recalc_member_balance() so the cached
-- number never drifts from the underlying rows.
create or replace function handle_member_balance_transfer()
returns trigger
language plpgsql
security definer
as $$
declare
  wallet_balance numeric;
  allocated numeric;
  allocated_cards numeric;
  available numeric;
  member_balance numeric;
  old_base_amount numeric;
  new_base_amount numeric;
  delta numeric;
  affected_member uuid;
begin
  if TG_OP = 'DELETE' then
    -- Removing a bad entry always frees up (or reduces) an allocation —
    -- no availability check needed, just recompute.
    perform recalc_member_balance(old.member_id);
    return old;
  end if;

  old_base_amount := case when TG_OP = 'UPDATE' then old.amount * old.exchange_rate_to_base else 0 end;
  new_base_amount := new.amount * new.exchange_rate_to_base;
  delta := new_base_amount - old_base_amount;
  affected_member := new.member_id;

  if delta > 0 then
    -- Net effect of this insert/edit is claiming MORE from the shared pool
    -- (either a bigger top-up, or a smaller return): make sure enough
    -- unallocated family balance exists.
    select balance_cache into wallet_balance from wallets where family_id = new.family_id;
    select coalesce(sum(balance), 0) into allocated from members where family_id = new.family_id;
    select coalesce(sum(balance_cache), 0) into allocated_cards from cards where family_id = new.family_id;
    available := coalesce(wallet_balance, 0) - allocated - allocated_cards;

    if delta > available then
      raise exception 'Not enough unallocated family balance (available: %)', round(available, 2);
    end if;
  elsif delta < 0 then
    -- Net effect is claiming LESS / returning more: make sure the member
    -- currently has enough allocated to cover it.
    select balance into member_balance from members where id = new.member_id;
    if abs(delta) > coalesce(member_balance, 0) then
      raise exception 'Not enough balance to return (your balance: %)', round(coalesce(member_balance, 0), 2);
    end if;
  end if;

  perform recalc_member_balance(affected_member);

  if TG_OP = 'INSERT' then
    insert into notifications (family_id, type, member_id, amount)
    values (
      new.family_id,
      case when new_base_amount > 0 then 'member_topup' else 'member_return' end,
      new.member_id,
      new_base_amount
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_balance_transfer on member_balance_transfers;
create trigger trg_member_balance_transfer
  after insert or update or delete on member_balance_transfers
  for each row execute function handle_member_balance_transfer();

-- ============================================================
-- 4c. Shared prepaid cards (e.g. a family fuel card). Any member can top
-- one up from the unallocated family balance, or log a withdrawal/spend
-- against it. Every member can see every card's live balance.
-- ============================================================
create table if not exists cards (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,
  balance_cache numeric not null default 0,
  archived boolean not null default false,
  created_by uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table cards add column if not exists archived boolean not null default false;

-- Top-ups: money moves from the family's unallocated balance onto the card.
create table if not exists card_transfers (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  amount numeric not null check (amount > 0),
  currency text not null default 'USD',
  exchange_rate_to_base numeric not null default 1,
  created_at timestamptz not null default now()
);

-- Withdrawals: real spending against the card, drawn from its own balance
-- (parallel to `transactions` for member spending, but not linked to any
-- member's personal budget/spending-limit tracking).
create table if not exists card_transactions (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  card_id uuid not null references cards(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  amount numeric not null check (amount > 0),
  currency text not null default 'USD',
  exchange_rate_to_base numeric not null default 1,
  note text,
  created_at timestamptz not null default now()
);

alter table notifications add column if not exists card_id uuid references cards(id) on delete cascade;

alter table cards enable row level security;
alter table card_transfers enable row level security;
alter table card_transactions enable row level security;

-- cards: readable by the whole family; only admins/superadmins can create.
-- Renaming/archiving a card (admin/superadmin only, balance_cache itself is
-- still only ever touched by the trigger functions below).
drop policy if exists "cards_select" on cards;
create policy "cards_select" on cards
  for select using (family_id in (select my_family_ids()));

drop policy if exists "cards_admin_insert" on cards;
create policy "cards_admin_insert" on cards
  for insert with check (is_admin(family_id));

drop policy if exists "cards_admin_update" on cards;
create policy "cards_admin_update" on cards
  for update using (is_admin(family_id));

-- card_transfers (top-ups): readable by family; any member can insert as
-- themselves.
drop policy if exists "card_transfers_select" on card_transfers;
create policy "card_transfers_select" on card_transfers
  for select using (family_id in (select my_family_ids()));

drop policy if exists "card_transfers_insert_self" on card_transfers;
create policy "card_transfers_insert_self" on card_transfers
  for insert with check (
    family_id in (select my_family_ids())
    and member_id in (select id from members where user_id = auth.uid())
  );

drop policy if exists "card_transfers_update_admin" on card_transfers;
create policy "card_transfers_update_admin" on card_transfers
  for update using (is_admin(family_id));

drop policy if exists "card_transfers_delete_admin" on card_transfers;
create policy "card_transfers_delete_admin" on card_transfers
  for delete using (is_admin(family_id));

-- card_transactions (withdrawals/spend): readable by family; any member can
-- insert as themselves.
drop policy if exists "card_transactions_select" on card_transactions;
create policy "card_transactions_select" on card_transactions
  for select using (family_id in (select my_family_ids()));

drop policy if exists "card_transactions_insert_self" on card_transactions;
create policy "card_transactions_insert_self" on card_transactions
  for insert with check (
    family_id in (select my_family_ids())
    and member_id in (select id from members where user_id = auth.uid())
  );

drop policy if exists "card_transactions_update_admin" on card_transactions;
create policy "card_transactions_update_admin" on card_transactions
  for update using (is_admin(family_id));

drop policy if exists "card_transactions_delete_admin" on card_transactions;
create policy "card_transactions_delete_admin" on card_transactions
  for delete using (is_admin(family_id));

-- Recomputes a card's cached balance from scratch (all top-ups minus all
-- withdrawals, in base currency) — same "recompute from scratch" pattern as
-- recalc_member_balance(), so UPDATE/DELETE corrections on the underlying
-- rows can never leave balance_cache drifted from reality.
create or replace function recalc_card_balance(target_card_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  total_topups numeric;
  total_withdrawals numeric;
begin
  select coalesce(sum(amount * exchange_rate_to_base), 0) into total_topups
  from card_transfers where card_id = target_card_id;
  select coalesce(sum(amount * exchange_rate_to_base), 0) into total_withdrawals
  from card_transactions where card_id = target_card_id;

  update cards set balance_cache = total_topups - total_withdrawals
  where id = target_card_id;
end;
$$;

-- Top-up trigger: check enough unallocated family balance exists (cash not
-- already claimed by a member's balance OR another card), then recompute
-- the card's cached balance and notify the family. Also handles admin
-- corrections (UPDATE/DELETE), validated against the *change* in amount.
create or replace function handle_card_transfer()
returns trigger
language plpgsql
security definer
as $$
declare
  wallet_balance numeric;
  allocated_members numeric;
  allocated_cards numeric;
  available numeric;
  old_base_amount numeric;
  new_base_amount numeric;
  delta numeric;
  card_archived boolean;
  affected_card uuid;
begin
  if TG_OP = 'DELETE' then
    perform recalc_card_balance(old.card_id);
    return old;
  end if;

  select archived into card_archived from cards where id = new.card_id;
  if coalesce(card_archived, false) then
    raise exception 'This card is archived and can no longer be topped up';
  end if;

  old_base_amount := case when TG_OP = 'UPDATE' then old.amount * old.exchange_rate_to_base else 0 end;
  new_base_amount := new.amount * new.exchange_rate_to_base;
  delta := new_base_amount - old_base_amount;
  affected_card := new.card_id;

  if delta > 0 then
    select balance_cache into wallet_balance from wallets where family_id = new.family_id;
    select coalesce(sum(balance), 0) into allocated_members from members where family_id = new.family_id;
    select coalesce(sum(balance_cache), 0) into allocated_cards from cards where family_id = new.family_id;
    available := coalesce(wallet_balance, 0) - allocated_members - allocated_cards;

    if delta > available then
      raise exception 'Not enough unallocated family balance (available: %)', round(available, 2);
    end if;
  end if;

  perform recalc_card_balance(affected_card);

  if TG_OP = 'INSERT' then
    insert into notifications (family_id, type, member_id, card_id, amount)
    values (new.family_id, 'card_topup', new.member_id, new.card_id, new_base_amount);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_card_transfer on card_transfers;
create trigger trg_card_transfer
  after insert or update or delete on card_transfers
  for each row execute function handle_card_transfer();

-- Withdrawal trigger: check the card actually has enough balance, then
-- recompute the card's cached balance and notify the family. Also handles
-- admin corrections (UPDATE/DELETE), validated against the *change* in
-- amount.
create or replace function handle_card_transaction()
returns trigger
language plpgsql
security definer
as $$
declare
  card_balance numeric;
  card_archived boolean;
  old_base_amount numeric;
  new_base_amount numeric;
  delta numeric;
  affected_card uuid;
begin
  if TG_OP = 'DELETE' then
    perform recalc_card_balance(old.card_id);
    return old;
  end if;

  select balance_cache, archived into card_balance, card_archived from cards where id = new.card_id;
  if coalesce(card_archived, false) then
    raise exception 'This card is archived and can no longer be used';
  end if;

  old_base_amount := case when TG_OP = 'UPDATE' then old.amount * old.exchange_rate_to_base else 0 end;
  new_base_amount := new.amount * new.exchange_rate_to_base;
  delta := new_base_amount - old_base_amount;
  affected_card := new.card_id;

  if delta > coalesce(card_balance, 0) then
    raise exception 'Not enough balance on this card (available: %)', round(coalesce(card_balance, 0), 2);
  end if;

  perform recalc_card_balance(affected_card);

  if TG_OP = 'INSERT' then
    insert into notifications (family_id, type, member_id, card_id, amount)
    values (new.family_id, 'card_withdraw', new.member_id, new.card_id, new_base_amount);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_card_transaction on card_transactions;
create trigger trg_card_transaction
  after insert or update or delete on card_transactions
  for each row execute function handle_card_transaction();

-- ============================================================
-- 5. REALTIME
-- ============================================================
-- Enable realtime on the tables the dashboard needs to live-update.
-- Wrapped in a guard so re-running this script doesn't error out on tables
-- that are already in the publication (a plain ALTER PUBLICATION ... ADD
-- TABLE throws if the table's already a member, which would otherwise abort
-- the rest of this script when re-running on an existing database).
do $$
declare
  t text;
begin
  foreach t in array array['transactions', 'deposits', 'wallets', 'members', 'planned_payments', 'member_balance_transfers', 'notifications', 'cards', 'card_transfers', 'card_transactions']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
