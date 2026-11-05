-- ============================================================================
-- Delete-account tests for the Supabase SQL editor. Run on a SCRATCH project only, after 0001-0019.
-- Paste the whole file and press Run. It builds its own throw-away users and families, checks the rules,
-- and ends with ROLLBACK so nothing is kept. A clean run ends with the error "ALL TESTS PASSED (rolled back)".
-- ============================================================================
begin;

create schema t;
grant usage on schema t to authenticated;
create function t.as_uid(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
end $$;
create function t.need(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'TEST FAILED: %', p_msg; end if; end $$;
create function t.mkuser(p_email text) returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, now(), now());
  return u;
end $$;
grant execute on all functions in schema t to authenticated;

do $$
declare ua uuid; ub uuid; uc uuid; f families; f2 families; i family_invites; mb members; ma members;
        err text; a_exists boolean;
begin
  ua := t.mkuser('del-admin@test.local'); ub := t.mkuser('del-member@test.local'); uc := t.mkuser('del-solo@test.local');

  -- family 1: A (superadmin) + B (member)
  perform t.as_uid(ua); set local role authenticated;
  f := create_family('Delete test family', 'Admin A');
  i := create_invite(f.id);
  reset role;
  perform t.as_uid(ub); set local role authenticated;
  mb := join_family(i.code, 'Member B');
  reset role;

  -- A is superadmin with no other admin: blocked
  perform t.as_uid(ua); set local role authenticated;
  begin perform delete_my_account(); err := null; exception when others then err := sqlerrm; end;
  reset role;
  perform t.need(err like '%superadmin%', 'superadmin with no other admin is blocked');
  perform t.need(exists (select 1 from auth.users where id = ua), 'blocked delete keeps the login');

  -- B holds money: blocked
  update wallet_accounts set balance_cache = 5 where member_id = mb.id and currency = 'USD';
  perform t.as_uid(ub); set local role authenticated;
  begin perform delete_my_account(); err := null; exception when others then err := sqlerrm; end;
  reset role;
  perform t.need(err like '%still hold money%', 'member with money is blocked');
  update wallet_accounts set balance_cache = 0 where member_id = mb.id;

  -- B (empty wallets) deletes: anonymised, family and A untouched
  perform t.as_uid(ub); set local role authenticated;
  perform delete_my_account();
  reset role;
  perform t.need(not exists (select 1 from auth.users where id = ub), 'B login is gone');
  perform t.need((select display_name from members where id = mb.id) = 'Former member'
                 and (select user_id from members where id = mb.id) is null
                 and (select removed_at from members where id = mb.id) is not null, 'B row anonymised and removed');
  perform t.need(exists (select 1 from families where id = f.id) and exists (select 1 from auth.users where id = ua), 'family and A untouched');
  perform t.need((select count(*) from wallet_accounts where member_id = mb.id) = 2, 'B wallet accounts kept for history');

  -- B can sign up again with a new login and join with a fresh invite (no clash with the old row)
  ub := t.mkuser('del-member2@test.local');
  perform t.as_uid(ua); set local role authenticated; i := create_invite(f.id); reset role;
  perform t.as_uid(ub); set local role authenticated; mb := join_family(i.code, 'Member B again'); reset role;

  -- make B an admin, then A (superadmin) may leave and B is promoted
  perform t.as_uid(ua); set local role authenticated; perform set_role(mb.id, 'admin'); reset role;
  perform t.as_uid(ua); set local role authenticated; perform delete_my_account(); reset role;
  perform t.need((select role from members where id = mb.id) = 'superadmin', 'admin promoted to superadmin');
  perform t.need(exists (select 1 from families where id = f.id), 'family survives');

  -- solo person: the family is deleted with them
  perform t.as_uid(uc); set local role authenticated;
  f2 := create_family('Solo family', 'Solo');
  perform delete_my_account();
  reset role;
  perform t.need(not exists (select 1 from families where id = f2.id), 'last member deletes the family');
  perform t.need(not exists (select 1 from auth.users where id = uc), 'solo login gone');
  perform t.need(not exists (select 1 from wallet_accounts where family_id = f2.id), 'solo family accounts gone');

  raise exception 'ALL TESTS PASSED (rolled back)';
end $$;

rollback;
