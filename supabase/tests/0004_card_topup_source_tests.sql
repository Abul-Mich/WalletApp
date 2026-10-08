-- ============================================================================
-- Card top-up from a member wallet tests for the Supabase SQL editor (no psql commands).
-- Run on a SCRATCH project only, after 0001-0008. Paste the whole file and press Run.
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
         t.bal(t.pool('USD')) as pool_usd, (select count(*) from cards) as cards, (select count(*) from transfers) as transfers,
         (select family_id from members where role = 'superadmin' and removed_at is null order by created_at limit 1) as fam;
grant select on start_state to authenticated;
create temp table tres (n serial, test text);
create temp table ctx (card uuid, acct uuid, give uuid, up1 uuid, up2 uuid);
grant select on ctx to authenticated;

do $$ declare s record; k cards; a uuid; g transfers; begin
  select * into s from start_state;
  perform t.as_user('superadmin'); set local role authenticated;
  k := create_card(s.fam, 'Source test', 'USD');
  reset role;
  select id into a from wallet_accounts where card_id = k.id;
  perform t.as_user('superadmin'); set local role authenticated;
  g := create_transfer(t.pool('USD'), t.wallet(t.mid('member'), 'USD'), 50);       -- give the member $50 to work with
  reset role;
  insert into ctx (card, acct, give) values (k.id, a, g.id);
  perform t.need(t.bal(t.wallet(t.mid('member'), 'USD')) >= 50, 'member has funds');
end $$;
insert into tres (test) values ('setup');

do $$ declare s record; c record; me uuid; sa uuid; w0 numeric; p0 numeric; r1 transfers; r2 transfers; begin
  select * into s from start_state; select * into c from ctx;
  me := t.mid('member'); sa := t.mid('superadmin');
  w0 := t.bal(t.wallet(me, 'USD')); p0 := t.bal(t.pool('USD'));
  perform t.as_user('member'); set local role authenticated;

  -- own wallet -> card works
  r1 := create_transfer(t.wallet(me, 'USD'), c.acct, 30, 'from my wallet', null, me);
  perform t.need(t.bal(t.wallet(me, 'USD')) = w0 - 30, 'member wallet dropped by 30');
  perform t.need(t.bal(c.acct) = 30, 'card received 30');
  perform t.need(t.bal(t.pool('USD')) = p0, 'pool untouched');
  -- pool -> card still works for a member
  r2 := create_transfer(t.pool('USD'), c.acct, 10);
  perform t.need(t.bal(c.acct) = 40 and t.bal(t.pool('USD')) = p0 - 10, 'pool top-up still works');

  -- what a member must NOT be able to do
  perform t.need(t.try(format($q$select create_transfer(%L,%L,5)$q$, t.wallet(sa,'USD'), c.acct)) is not null, 'cannot use another member wallet');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,500000)$q$, t.wallet(me,'USD'), c.acct)) is not null, 'cannot overdraw own wallet');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,5)$q$, c.acct, t.wallet(me,'USD'))) is not null, 'cannot take money out of a card');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,5)$q$, c.acct, t.pool('USD'))) is not null, 'cannot return card money to the pool');
  perform t.need(t.try(format($q$select create_transfer(%L,%L,5)$q$, t.wallet(me,'LBP'), c.acct)) is not null, 'currency mismatch refused');
  reset role;

  update ctx set up1 = r1.id, up2 = r2.id;
  perform t.need(exists (select 1 from notifications where card_id = c.card and type = 'card_topup'), 'top-up notification written');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches match entries');
end $$;
insert into tres (test) values ('member tops up from own wallet');

do $$ declare s record; c record; begin
  select * into s from start_state; select * into c from ctx;
  perform t.as_user('superadmin'); set local role authenticated;
  perform delete_transfer(c.up1); perform delete_transfer(c.up2); perform delete_transfer(c.give);
  reset role;
  delete from cards where id = c.card;
  perform t.need((select sum(balance_cache) from wallet_accounts) = s.total, 'family total unchanged');
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd, 'pool unchanged');
  perform t.need((select count(*) from cards) = s.cards, 'test card removed');
  perform t.need((select count(*) from transfers) = s.transfers, 'no leftover transfers');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches match entries');
end $$;
insert into tres (test) values ('everything back where it started');

drop schema t cascade;
select n, test, 'PASS' as result from tres union all select 999, 'ALL CARD-TOPUP-SOURCE TESTS PASSED', 'OK' order by 1;
