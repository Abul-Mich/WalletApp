-- ============================================================================
-- Edit tests (card spending and common expenses) for the Supabase SQL editor (no psql commands).
-- Run on a SCRATCH project only, after 0001-0012. Paste the whole file and press Run.
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
create temp table ctx (card uuid, acct uuid, spend uuid, common uuid, dep uuid);
grant select, update on ctx to authenticated;

do $$ declare s record; k cards; a uuid; begin
  select * into s from start_state;
  perform t.as_user('superadmin'); set local role authenticated;
  k := create_card(s.fam, 'Edit test', 'USD');
  reset role;
  select id into a from wallet_accounts where card_id = k.id;
  perform t.as_user('superadmin'); set local role authenticated;
  perform create_transfer(t.pool('USD'), a, 100);
  reset role;
  insert into ctx (card, acct) values (k.id, a);
end $$;
insert into tres (test) values ('setup');

-- a member edits their own card spend: money, limit and category follow
do $$ declare s record; c record; me uuid; cat uuid; r card_transactions; fam0 numeric; mem0 numeric; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  select id into cat from categories where family_id = s.fam order by name limit 1;
  perform t.as_user('member'); set local role authenticated;
  r := create_card_spend(c.card, 12, 'first', null, null, me);
  fam0 := period_spend(s.fam, null, null, now() - interval '1 hour');
  mem0 := period_spend(s.fam, me, null, now() - interval '1 hour');
  r := update_card_spend(r.id, 20, 'fixed', null, null, me, cat);
  perform t.need(r.amount = 20 and r.net_usd = 20 and r.note = 'fixed' and r.category_id = cat, 'card spend fields updated');
  perform t.need(period_spend(s.fam, null, null, now() - interval '1 hour') = fam0 + 8, 'family total follows the edit');
  perform t.need(period_spend(s.fam, me, null, now() - interval '1 hour') = mem0 + 8, 'member limit follows the edit');
  reset role;
  update ctx set spend = r.id;
  perform t.need(t.bal(c.acct) = 80, 'card balance 80 after edit');
end $$;
insert into tres (test) values ('member edits own card spend');

-- tag moves the limit; too-large edit refused and changes nothing; other members cannot edit it
do $$ declare s record; c record; me uuid; adm uuid; r card_transactions; before_me numeric; before_adm numeric; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member'); adm := t.mid('superadmin');
  perform t.as_user('superadmin'); set local role authenticated;
  before_me := period_spend(s.fam, me, null, now() - interval '1 hour');
  before_adm := period_spend(s.fam, adm, null, now() - interval '1 hour');
  r := update_card_spend(c.spend, 20, 'fixed', null, null, adm, null);
  perform t.need(r.tagged_member_id = adm, 'tag changed (an admin may edit someone else''s spend)');
  perform t.need(period_spend(s.fam, me, null, now() - interval '1 hour') = before_me - 20, 'limit left the old person');
  perform t.need(period_spend(s.fam, adm, null, now() - interval '1 hour') = before_adm + 20, 'limit moved to the new person');
  perform t.need(r.category_id is null, 'category cleared');
  perform t.need(t.try(format($q$select update_card_spend(%L, 500)$q$, c.spend)) is not null, 'edit above the card balance refused');
  perform t.need(t.try(format($q$select update_card_spend(%L, 0)$q$, c.spend)) is not null, 'zero amount refused');
  perform t.need(t.try(format($q$select update_card_spend(%L, 5, null, null, null, %L)$q$, c.spend, gen_random_uuid())) is not null, 'unknown person refused');
  reset role;
  perform t.need(t.bal(c.acct) = 80, 'card balance still 80');
  -- a spend logged by the admin cannot be edited by a plain member
  perform t.as_user('superadmin'); set local role authenticated;
  r := create_card_spend(c.card, 5, 'admin spend', null, null, adm);
  reset role;
  perform t.as_user('member'); set local role authenticated;
  perform t.need(t.try(format($q$select update_card_spend(%L, 6)$q$, r.id)) is not null, 'member cannot edit another person''s spend');
  reset role;
end $$;
insert into tres (test) values ('card spend edit rules');

-- common expense (admin): amount, title, tag, then move to the card
do $$ declare s record; c record; me uuid; r common_expenses; pool0 numeric; card0 numeric; fam0 numeric; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  pool0 := t.bal(t.pool('USD')); card0 := t.bal(c.acct);
  perform t.as_user('superadmin'); set local role authenticated;
  r := create_common_expense(s.fam, 'Edit me', 30, 'USD');
  update ctx set common = r.id;
  fam0 := period_spend(s.fam, null, null, now() - interval '1 hour');
  r := update_common_expense(r.id, 'Edited', 45, 'USD', null, null, 'note', me);
  perform t.need(r.title = 'Edited' and r.net_usd = 45 and r.tagged_member_id = me and r.note = 'note', 'fields updated');
  perform t.need(period_spend(s.fam, null, null, now() - interval '1 hour') = fam0 + 15, 'family total follows');
  reset role;
  perform t.need(t.bal(t.pool('USD')) = pool0 - 45, 'pool paid 45 in total');
  -- pay it from the card instead
  perform t.as_user('superadmin'); set local role authenticated;
  r := update_common_expense(r.id, 'Edited', 45, 'USD', null, null, 'note', me, null, c.acct);
  reset role;
  perform t.need(t.bal(t.pool('USD')) = pool0, 'pool refunded when the source changed');
  perform t.need(t.bal(c.acct) = card0 - 45, 'card now pays 45');
  -- too large for the card
  perform t.as_user('superadmin'); set local role authenticated;
  perform t.need(t.try(format($q$select update_common_expense(%L,'Edited',500,'USD',null,null,null,null,null,%L)$q$, r.id, c.acct)) is not null, 'edit above the card balance refused');
  -- a plain member cannot edit it
  reset role;
  perform t.as_user('member'); set local role authenticated;
  perform t.need(t.try(format($q$select update_common_expense(%L,'x',1,'USD')$q$, r.id)) is not null, 'member cannot edit common expenses');
  reset role;
  perform t.need(t.bal(c.acct) = card0 - 45, 'card unchanged by refused edits');
end $$;
insert into tres (test) values ('common expense edit');

-- LBP common expense: rate and currency changes (deposit some LBP into the pool first)
do $$ declare s record; c record; r common_expenses; d deposits; lp0 numeric; up0 numeric; begin
  select * into s from start_state; select * into c from ctx;
  perform t.as_user('superadmin'); set local role authenticated;
  d := create_deposit(t.pool('LBP'), 10000000, 90000);
  update ctx set dep = d.id;
  reset role;
  lp0 := t.bal(t.pool('LBP')); up0 := t.bal(t.pool('USD'));
  perform t.as_user('superadmin'); set local role authenticated;
  r := create_common_expense(s.fam, 'LBP bill', 900000, 'LBP', null, 90000);
  perform t.need(r.net_usd = 10, 'LBP net 10');
  r := update_common_expense(r.id, 'LBP bill', 1800000, 'LBP', null, 90000);
  perform t.need(r.net_usd = 20, 'LBP edit net 20');
  r := update_common_expense(r.id, 'LBP bill', 1800000, 'LBP', null, null);   -- rate omitted: keeps the recorded one
  perform t.need(r.lbp_per_usd = 90000 and r.net_usd = 20, 'recorded rate kept');
  r := update_common_expense(r.id, 'Now dollars', 8, 'USD');
  perform t.need(r.currency = 'USD' and r.lbp_per_usd is null and r.net_usd = 8, 'switched to USD');
  reset role;
  perform t.need(t.bal(t.pool('LBP')) = lp0, 'LBP pool fully refunded');
  perform t.need(t.bal(t.pool('USD')) = up0 - 8, 'USD pool paid 8');
  update ctx set common = r.id where card = c.card;
end $$;
insert into tres (test) values ('LBP and currency changes');

-- statistics follow a currency change (the rollup always reads the recomputed net_usd)
do $$ declare s record; r common_expenses; t0 numeric; ro jsonb; parts numeric; begin
  select * into s from start_state;
  perform t.as_user('superadmin'); set local role authenticated;
  t0 := (spend_rollup(s.fam)->>'total')::numeric;
  r := create_common_expense(s.fam, 'Stats switch', 900000, 'LBP', null, 90000);                     -- $10
  perform t.need(abs((spend_rollup(s.fam)->>'total')::numeric - (t0 + 10)) < 0.001, 'rollup after LBP create');
  r := update_common_expense(r.id, 'Stats switch', 12, 'USD');                                         -- LBP -> USD, $12
  ro := spend_rollup(s.fam);
  perform t.need(abs((ro->>'total')::numeric - (t0 + 12)) < 0.001, 'rollup after LBP to USD');
  perform t.need(r.lbp_per_usd is null and r.net_usd = 12, 'USD record keeps no rate');
  r := update_common_expense(r.id, 'Stats switch', 1080000, 'LBP', null, 90000);                      -- USD -> LBP at 90000 = $12
  ro := spend_rollup(s.fam);
  perform t.need(abs((ro->>'total')::numeric - (t0 + 12)) < 0.001 and r.net_usd = 12 and r.lbp_per_usd = 90000, 'rollup after USD to LBP');
  select coalesce(sum((x->>'total')::numeric),0) into parts from jsonb_array_elements(ro->'categories') x;
  perform t.need(abs(parts - (ro->>'total')::numeric) < 0.001, 'categories add up to total');
  select coalesce(sum((x->>'total')::numeric),0) into parts from jsonb_array_elements(ro->'daily') x;
  perform t.need(abs(parts - (ro->>'total')::numeric) < 0.001, 'days add up to total');
  select coalesce(sum((x->>'total')::numeric),0) into parts from jsonb_array_elements(ro->'people') x;
  perform t.need(abs(parts - (ro->>'total')::numeric) < 0.001, 'people add up to total');
  reset role;
end $$;
insert into tres (test) values ('statistics after currency changes');

-- tidy up
do $$ declare s record; c record; begin
  select * into s from start_state; select * into c from ctx;
  perform t.as_user('superadmin'); set local role authenticated;
  perform delete_common_expense(id) from common_expenses where title in ('Edited','Now dollars','LBP bill','Edit me','Stats switch');
  perform delete_card_spend(id) from card_transactions where card_id = c.card;
  perform delete_deposit(c.dep);
  perform delete_transfer(id) from transfers where to_account_id = c.acct;
  reset role;
  delete from cards where id = c.card;
  perform t.need((select sum(balance_cache) from wallet_accounts) = s.total, 'family total unchanged');
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd, 'pool unchanged');
  perform t.need((select count(*) from cards) = s.cards, 'test card removed');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches match entries');
end $$;
insert into tres (test) values ('everything back where it started');

drop schema t cascade;
select n, test, 'PASS' as result from tres union all select 999, 'ALL EDIT TESTS PASSED', 'OK' order by 1;
