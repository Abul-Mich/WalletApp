-- ============================================================================
-- Card spend category tests for the Supabase SQL editor (no psql commands).
-- Run on a SCRATCH project only, after 0001-0010. Paste the whole file and press Run.
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
create temp table ctx (card uuid, acct uuid);
grant select on ctx to authenticated;

do $$ declare s record; k cards; a uuid; begin
  select * into s from start_state;
  perform t.need(exists (select 1 from categories where family_id = s.fam), 'family needs at least one category');
  perform t.as_user('superadmin'); set local role authenticated;
  k := create_card(s.fam, 'Category test', 'USD');
  reset role;
  select id into a from wallet_accounts where card_id = k.id;
  perform t.as_user('superadmin'); set local role authenticated;
  perform create_transfer(t.pool('USD'), a, 100);
  reset role;
  insert into ctx values (k.id, a);
end $$;
insert into tres (test) values ('setup');

do $$ declare s record; c record; me uuid; cat uuid; cat0 numeric; fam0 numeric; mem0 numeric; r card_transactions; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  select id into cat from categories where family_id = s.fam order by name limit 1;
  perform t.as_user('member'); set local role authenticated;
  cat0 := period_spend(s.fam, null, cat, now() - interval '1 hour');
  fam0 := period_spend(s.fam, null, null, now() - interval '1 hour');
  mem0 := period_spend(s.fam, me, null, now() - interval '1 hour');
  r := create_card_spend(c.card, 12, 'with category', null, null, me, cat);
  perform t.need(r.category_id = cat, 'category saved on the card spend');
  perform t.need(period_spend(s.fam, null, cat, now() - interval '1 hour') = cat0 + 12, 'category total includes the card spend');
  perform t.need(period_spend(s.fam, null, null, now() - interval '1 hour') = fam0 + 12, 'family total includes it once');
  perform t.need(period_spend(s.fam, me, null, now() - interval '1 hour') = mem0 + 12, 'member limit includes it');
  -- without a category it still works and does not count in a category total
  r := create_card_spend(c.card, 5, 'no category', null, null, me);
  perform t.need(r.category_id is null, 'category stays empty');
  perform t.need(period_spend(s.fam, null, cat, now() - interval '1 hour') = cat0 + 12, 'category total unchanged by uncategorized spend');
  perform t.need(period_spend(s.fam, null, null, now() - interval '1 hour') = fam0 + 17, 'family total counts both');
  perform t.need(t.try(format($q$select create_card_spend(%L,1,'x',null,null,%L,%L)$q$, c.card, me, gen_random_uuid())) is not null, 'unknown category refused');
  reset role;
  perform t.need(t.bal(c.acct) = 83, 'card balance 83');
end $$;
insert into tres (test) values ('category on card spends');

do $$ declare s record; c record; begin
  select * into s from start_state; select * into c from ctx;
  perform t.as_user('superadmin'); set local role authenticated;
  perform delete_card_spend(id) from card_transactions where card_id = c.card;
  perform delete_transfer(id) from transfers where to_account_id = c.acct;
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
select n, test, 'PASS' as result from tres union all select 999, 'ALL CARD-CATEGORY TESTS PASSED', 'OK' order by 1;
