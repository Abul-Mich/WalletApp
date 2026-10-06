-- ============================================================================
-- 0004 · CUTOVER. Run only together with the new front end, in a quiet window,
--        after 0001-0003 and the reconciliation gate (end of 0002) passed.
--  * identity functions (create/join family, invites, limits, roles, removal)
--  * stops the old balance triggers and revokes every direct money write
--  * keeps old tables untouched and readable (frozen) for rollback
-- Rollback: rollback/0004_down.sql  (re-grants writes, restores old triggers)
-- ============================================================================
begin;

-- Safety check: the ledger must still match the old tables exactly. If anyone used
-- the old app after 0002, this stops here with a clear message and changes nothing.
-- (Fix: run rollback/0002_down.sql, then 0002_backfill.sql again, then this file.)
select ledger_reconcile();

-- removed members lose access but their history stays
create or replace function my_family_ids() returns setof uuid
language sql security definer stable set search_path = public as $$
  select family_id from members where user_id = auth.uid() and removed_at is null;
$$;
create or replace function my_role_in(fam_id uuid) returns text
language sql security definer stable set search_path = public as $$
  select role from members where user_id = auth.uid() and family_id = fam_id and removed_at is null limit 1;
$$;

-- ----------------------------------------------------- identity functions --
create function _new_member_accounts(p_family uuid, p_member uuid) returns void
language sql security definer set search_path = public as $$
  insert into wallet_accounts (family_id, owner_kind, member_id, currency)
  select p_family, 'member', p_member, c from unnest(array['USD','LBP']) c
  on conflict do nothing;
$$;

create function create_family(p_name text, p_display_name text) returns families
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); f families; m members;
begin
  if u is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if exists (select 1 from members where user_id = u and removed_at is null) then
    raise exception 'You already belong to a family'; end if;
  if nullif(btrim(p_name),'') is null or nullif(btrim(p_display_name),'') is null then
    raise exception 'Family name and your name are required'; end if;
  insert into families (name, base_currency) values (btrim(p_name), 'USD') returning * into f;
  insert into members (family_id, user_id, display_name, role) values (f.id, u, btrim(p_display_name), 'superadmin') returning * into m;
  insert into wallets (family_id) values (f.id);                       -- legacy row, kept for rollback
  insert into wallet_accounts (family_id, owner_kind, currency) select f.id, 'pool', c from unnest(array['USD','LBP']) c;
  perform _new_member_accounts(f.id, m.id);
  return f;
end $$;

create function create_invite(p_family_id uuid) returns family_invites
language plpgsql security definer set search_path = public as $$
declare c members; i family_invites;
begin
  c := _caller(p_family_id);
  if not _is_admin(c) then raise exception 'Only admins can create invites' using errcode = '42501'; end if;
  insert into family_invites (family_id, code, created_by_member_id)
  values (p_family_id, substr(replace(gen_random_uuid()::text,'-',''), 1, 12), c.id) returning * into i;
  return i;
end $$;

create function join_family(p_code text, p_display_name text) returns members
language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); i family_invites; m members;
begin
  if u is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if nullif(btrim(p_display_name),'') is null then raise exception 'Your name is required'; end if;
  if exists (select 1 from members where user_id = u and removed_at is null) then
    raise exception 'You already belong to a family'; end if;
  select * into i from family_invites
   where code = btrim(p_code) and used_at is null and expires_at > now() for update;
  if not found then raise exception 'This invite is invalid, used or expired'; end if;
  select * into m from members where family_id = i.family_id and user_id = u;    -- re-joining after removal
  if found then
    update members set removed_at = null, role = 'member', display_name = btrim(p_display_name) where id = m.id returning * into m;
  else
    insert into members (family_id, user_id, display_name, role) values (i.family_id, u, btrim(p_display_name), 'member') returning * into m;
  end if;
  perform _new_member_accounts(i.family_id, m.id);
  update family_invites set used_at = now() where id = i.id;
  return m;
end $$;

create function set_member_limit(p_member_id uuid, p_amount numeric, p_period text) returns members
language plpgsql security definer set search_path = public as $$
declare t members; c members;
begin
  select * into t from members where id = p_member_id and removed_at is null;
  if not found then raise exception 'Member not found'; end if;
  c := _caller(t.family_id);
  if not _is_admin(c) then raise exception 'Only admins can set limits' using errcode = '42501'; end if;
  if p_amount is null then
    update members set spending_limit_amount = null, spending_limit_period = null where id = t.id returning * into t;
  else
    if p_amount <= 0 or p_period not in ('weekly','monthly') then raise exception 'Limit needs a positive amount and weekly or monthly'; end if;
    update members set spending_limit_amount = p_amount, spending_limit_period = p_period where id = t.id returning * into t;
  end if;
  return t;
end $$;

create function set_role(p_member_id uuid, p_role text) returns members
language plpgsql security definer set search_path = public as $$
declare t members; c members;
begin
  select * into t from members where id = p_member_id and removed_at is null;
  if not found then raise exception 'Member not found'; end if;
  c := _caller(t.family_id);
  if c.role <> 'superadmin' then raise exception 'Only the superadmin can change roles' using errcode = '42501'; end if;
  if t.role = 'superadmin' then raise exception 'The superadmin role cannot be changed'; end if;
  if p_role not in ('admin','member') then raise exception 'Role must be admin or member'; end if;
  update members set role = p_role where id = t.id returning * into t;
  return t;
end $$;

create function remove_member(p_member_id uuid) returns members
language plpgsql security definer set search_path = public as $$
declare t members; c members; v_left numeric;
begin
  select * into t from members where id = p_member_id and removed_at is null;
  if not found then raise exception 'Member not found'; end if;
  c := _caller(t.family_id);
  if not _is_admin(c) then raise exception 'Only admins can remove members' using errcode = '42501'; end if;
  if t.role = 'superadmin' then raise exception 'The superadmin cannot be removed'; end if;
  select coalesce(sum(balance_cache),0) into v_left from wallet_accounts where member_id = t.id;
  if v_left <> 0 then raise exception 'This member still holds money in their wallets; move it back to the pool first'; end if;
  update members set removed_at = now() where id = t.id returning * into t;     -- history keeps their name
  return t;
end $$;

-- ----------------------------------------- stop old balance logic, freeze it --
drop trigger if exists trg_transactions_recalc               on transactions;
drop trigger if exists trg_transactions_recalc_member_balance on transactions;
drop trigger if exists trg_transactions_check_balance        on transactions;
drop trigger if exists trg_deposits_recalc                   on deposits;
drop trigger if exists trg_card_transaction                  on card_transactions;
drop trigger if exists trg_card_transfer                     on card_transfers;
drop trigger if exists trg_member_balance_transfer           on member_balance_transfers;
drop trigger if exists trg_wallet_adjustments_recalc         on wallet_balance_adjustments;
drop trigger if exists trg_wallet_adjustments_check          on wallet_balance_adjustments;

-- --------------------------------------------------- revoke direct writes --
-- Everything except SELECT is taken away from the old money tables (TRUNCATE, TRIGGER
-- and REFERENCES too); anon gets nothing. Column grants below re-open the few editable fields.
revoke all on
  transactions, deposits, card_transactions, card_transfers, member_balance_transfers,
  wallet_balance_adjustments, wallets, notifications, family_invites, members, families, cards
  from anon, authenticated;
grant select on
  transactions, deposits, card_transactions, card_transfers, member_balance_transfers,
  wallet_balance_adjustments, wallets, notifications, family_invites, members, families, cards
  to authenticated;
revoke all on wallet_accounts, wallet_entries, transfers, exchanges, transaction_legs, opening_entries from anon;

grant update (display_name, preferred_currency) on members  to authenticated;
grant update (name, budget_amount, budget_period) on families to authenticated;
grant update (name, archived) on cards to authenticated;
drop policy if exists members_insert_self on members;

-- invites: only admins of the family can read them; joining goes through join_family()
drop policy if exists invites_lookup_by_code on family_invites;
drop policy if exists invites_select on family_invites;
create policy invites_select on family_invites for select using (is_admin(family_id));
drop policy if exists invites_admin_insert on family_invites;

-- ------------------------------------------------------------- functions --
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_family','create_invite','join_family','set_member_limit','set_role','remove_member')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
  execute 'revoke all on function _new_member_accounts(uuid,uuid) from public, anon, authenticated';
end $$;

-- ----------------------------------------------------------- realtime ------
do $$
declare t text;
begin
  foreach t in array array['wallet_accounts','wallet_entries','transfers','exchanges','transaction_legs']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- the old-vs-new comparison is meaningless once the old tables are frozen
drop function if exists ledger_reconcile();

commit;
