-- ============================================================================
-- Pockets tests for the Supabase SQL editor (no psql commands).
-- Run on a SCRATCH project only, after 0001-0013. Paste the whole file and press Run.
-- Any failure shows an error starting with "TEST FAILED" and the whole run is rolled back.
-- Everything it creates is removed again. Needs a superadmin and a plain member.
-- ============================================================================
create schema t;
grant usage on schema t to authenticated;

create function t.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function t.as_uid(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
end $$;
create function t.as_user(p_member text) returns void language plpgsql as $$
begin perform t.as_uid((select user_id from members where role = p_member and removed_at is null order by created_at limit 1)); end $$;
create function t.mid(p_role text) returns uuid language sql as $$
  select id from members where role = p_role and removed_at is null order by created_at limit 1 $$;
create function t.pool(p_cur text) returns uuid language sql as $$
  select id from wallet_accounts where owner_kind = 'pool' and currency = p_cur limit 1 $$;
create function t.wallet(p_member uuid, p_cur text) returns uuid language sql as $$
  select id from wallet_accounts where owner_kind = 'member' and member_id = p_member and currency = p_cur $$;
create function t.bal(p_acct uuid) returns numeric language sql as $$
  select balance_cache from wallet_accounts where id = p_acct $$;
create function t.need(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'TEST FAILED: %', p_msg; end if; end $$;
grant execute on all functions in schema t to authenticated;

create temp table start_state as
  select (select sum(balance_cache) from wallet_accounts) as total,
         t.bal(t.pool('USD')) as pool_usd, (select count(*) from pockets) as pockets, (select count(*) from transfers) as transfers,
         (select family_id from members where role = 'superadmin' and removed_at is null order by created_at limit 1) as fam;
grant select on start_state to authenticated;
create temp table tres (n serial, test text);
create temp table ctx (pk uuid, acct uuid, pk2 uuid, acct2 uuid, w0 numeric);
grant select on ctx to authenticated;

-- setup: the admin gives the member 100 USD, the member creates a pocket with 30 from the wallet
do $$ declare s record; me uuid; p pockets; a uuid; w0 numeric; begin
  select * into s from start_state; me := t.mid('member'); w0 := t.bal(t.wallet(me,'USD'));
  perform t.as_user('superadmin'); set local role authenticated;
  perform create_transfer(t.pool('USD'), t.wallet(me,'USD'), 100);
  perform t.as_user('member');
  p := create_pocket(s.fam, '  Holiday ', 'USD', '#5b8def', 30);
  reset role;
  select id into a from wallet_accounts where pocket_id = p.id;
  insert into ctx (pk, acct, w0) values (p.id, a, w0);
  perform t.need(p.name = 'Holiday' and p.member_id = me, 'name trimmed, owned by caller');
  perform t.need(t.bal(a) = 30 and t.bal(t.wallet(me,'USD')) = w0 + 70, 'start amount moved from main wallet');
end $$;
insert into tres (test) values ('create pocket with a starting amount');

do $$ declare s record; c record; me uuid; r transfers; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('member'); set local role authenticated;
  perform t.need(t.try(format($q$select create_pocket(%L,'holiday','USD')$q$, s.fam)) is not null, 'duplicate name refused (case-insensitive)');
  perform t.need(t.try(format($q$select create_pocket(%L,'','USD')$q$, s.fam)) is not null, 'empty name refused');
  perform t.need(t.try(format($q$select create_pocket(%L,'X','EUR')$q$, s.fam)) is not null, 'bad currency refused');
  perform t.need(t.try(format($q$select create_pocket(%L,'X','USD','red')$q$, s.fam)) is not null, 'bad colour refused');
  perform t.need(t.try(format($q$select create_pocket(%L,'X','USD',null,-5)$q$, s.fam)) is not null, 'negative start refused');
  -- move in / out
  r := create_transfer(t.wallet(me,'USD'), c.acct, 20);
  perform t.need(t.bal(c.acct) = 50 and t.bal(t.wallet(me,'USD')) = c.w0 + 50, 'moved 20 in');
  perform create_transfer(c.acct, t.wallet(me,'USD'), 10);
  perform t.need(t.bal(c.acct) = 40, 'moved 10 out');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,500)$q$, c.acct, t.wallet(me,'USD'))) is not null, 'cannot overdraw a pocket');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,5)$q$, t.pool('USD'), c.acct)) is not null, 'pool -> pocket refused');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,5)$q$, c.acct, t.pool('USD'))) is not null, 'pocket -> pool refused');
  perform t.need(t.try(format($q$select create_deposit(%L,5)$q$, c.acct)) is not null, 'deposit into pocket refused');
  perform t.need(t.try(format($q$select create_exchange(%L,%L,1,90000)$q$, c.acct, c.acct)) is not null, 'exchange with a pocket refused');
  -- no notifications for pocket moves
  reset role;
  perform t.need(not exists (select 1 from notifications n where n.created_at > now() - interval '1 minute' and n.amount in (20,10) and n.type in ('member_topup','member_return')), 'no notification for pocket moves');
end $$;
insert into tres (test) values ('member moves money in and out; other routes refused');

-- privacy and admin rules: the admin can neither move money nor change another member's pocket, only see it
do $$ declare s record; c record; sa uuid; me uuid; begin
  select * into s from start_state; select * into c from ctx; sa := t.mid('superadmin'); me := t.mid('member');
  perform t.as_user('superadmin'); set local role authenticated;
  perform t.need(exists (select 1 from pockets where id = c.pk), 'admin can see the pocket');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,5)$q$, c.acct, t.wallet(me,'USD'))) is not null, 'admin cannot move money out of a member pocket');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,5)$q$, t.wallet(me,'USD'), c.acct)) is not null, 'admin cannot move money into a member pocket');
  perform t.need(t.try(format($q$select rename_pocket(%L,'Hacked')$q$, c.pk)) is not null, 'admin cannot rename it');
  perform t.need(t.try(format($q$select set_pocket_archived(%L,true)$q$, c.pk)) is not null, 'admin cannot archive it');
  reset role;
  -- the owner's pocket is invisible to the admin's own pocket list? admin sees all, so test a third party via the policy text instead
  perform t.need(exists (select 1 from pg_policies where tablename = 'pockets' and policyname = 'pockets_select'), 'pocket policy exists');
  perform t.need((select relrowsecurity from pg_class where relname = 'pockets'), 'RLS on pockets');
end $$;
insert into tres (test) values ('admin sees but cannot touch member pockets');

-- a superadmin's own pocket is invisible to a plain member
do $$ declare s record; p pockets; begin
  select * into s from start_state;
  perform t.as_user('superadmin'); set local role authenticated;
  p := create_pocket(s.fam, 'Admin private', 'USD');
  reset role;
  update ctx set pk2 = p.id, acct2 = (select id from wallet_accounts where pocket_id = p.id);
  perform t.as_user('member'); set local role authenticated;
  perform t.need(not exists (select 1 from pockets where id = p.id), 'member cannot see the admin pocket');
  perform t.need(not exists (select 1 from wallet_accounts where pocket_id = p.id), 'member cannot see the pocket account');
  perform t.need((select count(*) from pockets where member_id = t.mid('member')) >= 1, 'member still sees own pocket');
  reset role;
end $$;
insert into tres (test) values ('pockets are private to their owner');

-- rename, archive rules
do $$ declare s record; c record; me uuid; p pockets; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('member'); set local role authenticated;
  p := rename_pocket(c.pk, 'Trip', '#3ecf8e');
  perform t.need(p.name = 'Trip' and p.color = '#3ecf8e', 'renamed');
  perform t.need(t.try(format($q$select set_pocket_archived(%L,true)$q$, c.pk)) is not null, 'cannot archive while it holds money');
  perform create_transfer(c.acct, t.wallet(me,'USD'), t.bal(c.acct));
  perform t.need(t.bal(c.acct) = 0, 'emptied');
  p := set_pocket_archived(c.pk, true);
  perform t.need(p.archived, 'archived');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,1)$q$, t.wallet(me,'USD'), c.acct)) is not null, 'archived pocket takes no money');
  p := create_pocket(s.fam, 'Trip', 'USD');   -- name is free again
  perform t.need(t.try(format($q$select set_pocket_archived(%L,false)$q$, c.pk)) is not null, 'unarchive refused while the name is taken');
  reset role;
  delete from pockets where id = p.id;
end $$;
insert into tres (test) values ('rename and archive rules');

-- cleanup: put the money back, then check the ledger
do $$ declare s record; c record; me uuid; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('superadmin'); set local role authenticated;
  perform delete_transfer(x.id) from (select id from transfers where from_account_id in (c.acct, c.acct2) or to_account_id in (c.acct, c.acct2)
                                      order by created_at desc, (to_account_id in (c.acct, c.acct2)), id) x;   -- moves out first, then moves in
  perform delete_transfer(x.id) from (select id from transfers where from_account_id = t.pool('USD') and to_account_id = t.wallet(me,'USD')
                                      and amount = 100 and created_at > now() - interval '1 hour' order by created_at desc limit 1) x;
  reset role;
  delete from pockets where id in (c.pk, c.pk2);
  perform t.need((select sum(balance_cache) from wallet_accounts) = s.total, 'family total unchanged');
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd, 'pool unchanged');
  perform t.need((select count(*) from pockets) = s.pockets, 'test pockets removed');
  perform t.need(not exists (select 1 from wallet_accounts where owner_kind = 'pocket'), 'no stray pocket accounts');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches match entries');
end $$;
insert into tres (test) values ('everything back where it started');

drop schema t cascade;
select n, test, 'PASS' as result from tres union all select 999, 'ALL POCKET TESTS PASSED', 'OK' order by 1;
