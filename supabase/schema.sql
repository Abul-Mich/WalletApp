-- Family Wallet App — Day 1 Schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New Query)
-- Safe to re-run: drops existing objects first (only use this while developing).

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
  created_at timestamptz not null default now()
);

create table if not exists members (
  id uuid primary key default uuid_generate_v4(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('admin', 'member')) default 'member',
  spending_limit_amount numeric,
  spending_limit_period text check (spending_limit_period in ('weekly', 'monthly')),
  preferred_currency text not null default 'USD',
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

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
  is_default boolean not null default false
);

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

-- ============================================================
-- 2. HELPER FUNCTION (avoids recursive RLS lookups)
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

-- families: readable/writable only if you're a member of it
drop policy if exists "families_select" on families;
create policy "families_select" on families
  for select using (id in (select my_family_ids()));

drop policy if exists "families_insert" on families;
create policy "families_insert" on families
  for insert with check (true); -- anyone authenticated can create a new family (they become its admin via app logic)

drop policy if exists "families_update" on families;
create policy "families_update" on families
  for update using (my_role_in(id) = 'admin');

-- members: readable by anyone in the same family; writable (role/limits) by admin only
drop policy if exists "members_select" on members;
create policy "members_select" on members
  for select using (family_id in (select my_family_ids()));

drop policy if exists "members_insert_self" on members;
create policy "members_insert_self" on members
  for insert with check (user_id = auth.uid());

drop policy if exists "members_update_admin" on members;
create policy "members_update_admin" on members
  for update using (my_role_in(family_id) = 'admin' or user_id = auth.uid());

drop policy if exists "members_delete_admin" on members;
create policy "members_delete_admin" on members
  for delete using (my_role_in(family_id) = 'admin');

-- wallets: readable by family, writable by admin (deposits update balance via app logic / triggers)
drop policy if exists "wallets_select" on wallets;
create policy "wallets_select" on wallets
  for select using (family_id in (select my_family_ids()));

drop policy if exists "wallets_all_admin" on wallets;
create policy "wallets_all_admin" on wallets
  for all using (my_role_in(family_id) = 'admin');

-- categories: readable by family; writable by admin only
drop policy if exists "categories_select" on categories;
create policy "categories_select" on categories
  for select using (family_id in (select my_family_ids()));

drop policy if exists "categories_admin_write" on categories;
create policy "categories_admin_write" on categories
  for insert with check (my_role_in(family_id) = 'admin');

drop policy if exists "categories_admin_update" on categories;
create policy "categories_admin_update" on categories
  for update using (my_role_in(family_id) = 'admin');

drop policy if exists "categories_admin_delete" on categories;
create policy "categories_admin_delete" on categories
  for delete using (my_role_in(family_id) = 'admin');

-- deposits: readable by family; only admin can insert
drop policy if exists "deposits_select" on deposits;
create policy "deposits_select" on deposits
  for select using (family_id in (select my_family_ids()));

drop policy if exists "deposits_admin_insert" on deposits;
create policy "deposits_admin_insert" on deposits
  for insert with check (my_role_in(family_id) = 'admin');

-- transactions: readable by family; any member can insert their own transaction
drop policy if exists "transactions_select" on transactions;
create policy "transactions_select" on transactions
  for select using (family_id in (select my_family_ids()));

drop policy if exists "transactions_insert_self" on transactions;
create policy "transactions_insert_self" on transactions
  for insert with check (
    family_id in (select my_family_ids())
    and member_id in (select id from members where user_id = auth.uid())
  );

drop policy if exists "transactions_delete_own_or_admin" on transactions;
create policy "transactions_delete_own_or_admin" on transactions
  for delete using (
    member_id in (select id from members where user_id = auth.uid())
    or my_role_in(family_id) = 'admin'
  );

-- exchange_rate_overrides: readable by family; only admin can insert
drop policy if exists "rate_overrides_select" on exchange_rate_overrides;
create policy "rate_overrides_select" on exchange_rate_overrides
  for select using (family_id in (select my_family_ids()));

drop policy if exists "rate_overrides_admin_insert" on exchange_rate_overrides;
create policy "rate_overrides_admin_insert" on exchange_rate_overrides
  for insert with check (my_role_in(family_id) = 'admin');

-- family_invites: readable by family members (to see/share the code); only admin creates
drop policy if exists "invites_select" on family_invites;
create policy "invites_select" on family_invites
  for select using (family_id in (select my_family_ids()));

drop policy if exists "invites_admin_insert" on family_invites;
create policy "invites_admin_insert" on family_invites
  for insert with check (my_role_in(family_id) = 'admin');

-- Public/limited lookup for join-by-code: allow any authenticated user to look up
-- an invite row by code alone (needed before they're a member of the family).
drop policy if exists "invites_lookup_by_code" on family_invites;
create policy "invites_lookup_by_code" on family_invites
  for select using (auth.uid() is not null);

-- ============================================================
-- 4. TRIGGERS — keep wallets.balance_cache in sync
-- ============================================================
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

-- ============================================================
-- 5. REALTIME
-- ============================================================
-- Enable realtime on the tables the dashboard needs to live-update.
alter publication supabase_realtime add table transactions;
alter publication supabase_realtime add table deposits;
alter publication supabase_realtime add table wallets;
alter publication supabase_realtime add table members;
