  -- ============================================================================
  -- 0019 · Delete my account.
  --  * A person can erase their own account. Their login, email, name, limits, phone-alert devices and
  --    unused invites are removed. The family's history is NOT rewritten: their old records stay in the
  --    ledger, shown as "Former member", so every total and the pool stay correct.
  --  * Rules: wallets (and pockets) must hold no money. A superadmin can leave only if another admin
  --    exists; that admin is promoted to superadmin so the family is never without one.
  --  * If they are the last active member, the whole family and all of its data are deleted too.
  --  * members.user_id becomes nullable and no longer cascades from auth.users, because deleting a member
  --    row would try to delete their wallet accounts, which old transfers still point to.
  -- Needs 0001-0018. Rollback: rollback/0019_down.sql. Test: tests/0012_delete_account_tests.sql (scratch only).
  -- ============================================================================
  begin;

  alter table members alter column user_id drop not null;

  do $$ declare c text; begin
    for c in
      select con.conname from pg_constraint con
      where con.conrelid = 'public.members'::regclass and con.contype = 'f'
        and con.confrelid = 'auth.users'::regclass
    loop
      execute format('alter table public.members drop constraint %I', c);
    end loop;
  end $$;
  alter table members drop constraint if exists members_user_id_fkey;
  alter table members add constraint members_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

  -- The role guard blocks a second superadmin and any change to a superadmin. Leaving the family is the one
  -- legitimate hand-over, so delete_my_account() raises a transaction-local flag (same pattern as the balance guard).
  create or replace function prevent_role_privilege_escalation()
  returns trigger
  language plpgsql
  security definer
  as $$
  begin
    if new.role is distinct from old.role then
      if coalesce(current_setting('app.allow_role_handover', true), 'off') = 'on' then
        return new;
      end if;
      if new.role = 'superadmin' then
        if exists (
          select 1 from members where family_id = old.family_id and role = 'superadmin'
        ) then
          raise exception 'this family already has a superadmin';
        end if;
      elsif old.role = 'superadmin' then
        raise exception 'superadmin role cannot be changed once set';
      else
        if not is_admin(old.family_id) then
          raise exception 'only an admin can change a member''s role';
        end if;
      end if;
    end if;
    return new;
  end;
  $$;

  create or replace function delete_my_account() returns void
  language plpgsql security definer set search_path = public, auth as $$
  declare
    u uuid := auth.uid();
    m members;
    v_others int;
    v_left numeric;
    v_next members;
  begin
    if u is null then raise exception 'Sign in first' using errcode = '42501'; end if;

    select * into m from members where user_id = u and removed_at is null order by created_at limit 1;

    if found then
      select count(*) into v_others from members
      where family_id = m.family_id and removed_at is null and id <> m.id;

      if v_others = 0 then
        -- Last person in the family: the whole family goes with them.
        delete from families where id = m.family_id;
      else
        select coalesce(sum(balance_cache), 0) into v_left from wallet_accounts where member_id = m.id;
        if v_left <> 0 then
          raise exception 'Your wallets still hold money; move it back to the pool first';
        end if;

        if m.role = 'superadmin' then
          select * into v_next from members
          where family_id = m.family_id and removed_at is null and id <> m.id and role = 'admin'
          order by created_at limit 1;
          if not found then
            raise exception 'You are the superadmin. Make another member an admin first, then delete your account';
          end if;
          perform set_config('app.allow_role_handover', 'on', true);
          update members set role = 'member' where id = m.id;
          update members set role = 'superadmin' where id = v_next.id;
          perform set_config('app.allow_role_handover', 'off', true);
        end if;

        delete from push_subscriptions where member_id = m.id;
        delete from family_invites where created_by_member_id = m.id and used_at is null;
        update pockets set name = 'Closed pocket', archived = true where member_id = m.id;
      end if;
    end if;

    -- Every membership this login ever had (including earlier removed ones) loses its name and link.
    update members
      set user_id = null,
          display_name = 'Former member',
          spending_limit_amount = null,
          spending_limit_period = null,
          removed_at = coalesce(removed_at, now())
    where user_id = u;

    delete from auth.users where id = u;
  end $$;

  revoke all on function delete_my_account() from public, anon;
  grant execute on function delete_my_account() to authenticated;

  commit;
