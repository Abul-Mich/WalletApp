-- ============================================================================
-- Common-expense "paid from card" tests for the Supabase SQL editor (no psql commands).
-- Run on a SCRATCH project only, after 0001-0007. Paste the whole file and press Run.
-- Any failure shows an error starting with "TEST FAILED" and the whole run is rolled back.
-- Everything it creates is removed again; the script can be run repeatedly.
-- Needs a superadmin and a plain member (as in your data).
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
create function t.bal(p_acct uuid) returns numeric language sql as $$
  select balance_cache from wallet_accounts where id = p_acct $$;
create function t.need(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'TEST FAILED: %', p_msg; end if; end $$;
grant execute on all functions in schema t to authenticated;

create temp table start_state as
  select (select sum(balance_cache) from wallet_accounts) as total,
         t.bal(t.pool('USD')) as pool_usd,
         (select count(*) from common_expenses) as ces, (select count(*) from common_bills) as bills,
         (select count(*) from cards) as cards,
         (select family_id from members where role = 'superadmin' and removed_at is null order by created_at limit 1) as fam;
grant select on start_state to authenticated;
create temp table tres (n serial, test text);
create temp table ctx (card uuid, acct uuid, topup uuid);
grant select on ctx to authenticated;

-- == Preflight
do $$ begin
  perform t.need(exists (select 1 from pg_proc where proname = 'create_common_expense' and pronargs = 10), '0007 is not applied');
end $$;
insert into tres (test) values ('preflight');

-- == Set up a USD test card with $100 from the pool
do $$ declare s record; k cards; a uuid; tr transfers; begin
  select * into s from start_state;
  perform t.as_user('superadmin'); set local role authenticated;
  k := create_card(s.fam, 'Test wallet', 'USD');
  reset role;
  select id into a from wallet_accounts where card_id = k.id;
  perform t.as_user('superadmin'); set local role authenticated;
  tr := create_transfer(t.pool('USD'), a, 100, 'test top-up', null, null);
  reset role;
  insert into ctx values (k.id, a, tr.id);
  perform t.need(t.bal(a) = 100, 'card holds 100');
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd - 100, 'pool gave 100');
end $$;
insert into tres (test) values ('card set up');

-- == Pay a common expense from the card
do $$ declare s record; c record; me uuid; ce common_expenses; sp0 numeric; spm0 numeric; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('superadmin'); set local role authenticated;
  sp0 := period_spend(s.fam, null, null, now() - interval '1 hour');
  spm0 := period_spend(s.fam, me, null, now() - interval '1 hour');
  ce := create_common_expense(s.fam, 'Tuition', 40, 'USD', null, null, null, me, null, c.acct);
  perform t.need(ce.account_id = c.acct, 'expense recorded against the card');
  perform t.need(t.bal(c.acct) = 60, 'card dropped to 60, got ' || t.bal(c.acct));
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd - 100, 'pool untouched by a card payment');
  perform t.need(period_spend(s.fam, null, null, now() - interval '1 hour') = sp0 + 40, 'family spend rose by 40');
  perform t.need(period_spend(s.fam, me, null, now() - interval '1 hour') = spm0, 'tagged member limit untouched');

  -- refusals
  perform t.need(t.try(format($q$select create_common_expense(%L,'Too much',500,'USD',null,null,null,null,null,%L)$q$, s.fam, c.acct)) is not null, 'overspending the card refused');
  perform t.need(t.try(format($q$select create_common_expense(%L,'Wrong currency',900000,'LBP',null,90000,null,null,null,%L)$q$, s.fam, c.acct)) is not null, 'LBP expense on a USD card refused');
  perform t.need(t.try(format($q$select create_common_expense(%L,'Member wallet',5,'USD',null,null,null,null,null,%L)$q$, s.fam, (select id from wallet_accounts where owner_kind='member' and currency='USD' limit 1))) is not null, 'a member wallet is not a card');
  perform t.need(t.try(format($q$select create_common_expense(%L,'Ghost',5,'USD',null,null,null,null,null,%L)$q$, s.fam, gen_random_uuid())) is not null, 'unknown account refused');
  perform t.need(t.bal(c.acct) = 60, 'refusals changed nothing');

  -- deleting it returns the money to the card, not the pool
  perform delete_common_expense(ce.id);
  perform t.need(t.bal(c.acct) = 100, 'card back to 100');
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd - 100, 'pool still untouched');
  reset role;
end $$;
insert into tres (test) values ('expense paid from card');

-- == Pay a bill from the card; pool-only still works
do $$ declare s record; c record; b common_bills; r common_expenses; begin
  select * into s from start_state; select * into c from ctx;
  perform t.as_user('superadmin'); set local role authenticated;
  b := create_common_bill(s.fam, 'Semester', 70, 'USD', 'monthly', date '2026-01-31', null, t.mid('member'));
  r := pay_common_bill(b.id, null, null, null, c.acct);
  perform t.need(r.account_id = c.acct and r.amount = 70 and r.bill_id = b.id, 'bill paid from the card');
  perform t.need(t.bal(c.acct) = 30, 'card at 30');
  perform t.need((select next_due_date from common_bills where id = b.id) = date '2026-02-28', 'due date moved');
  perform t.need(t.try(format($q$select pay_common_bill(%L,null,null,null,%L)$q$, b.id, c.acct)) is not null, 'second payment exceeds the card, refused');
  perform t.need((select next_due_date from common_bills where id = b.id) = date '2026-02-28', 'refused payment did not move the date');
  r := pay_common_bill(b.id);                                               -- no account = pool, as before
  perform t.need(r.account_id = t.pool('USD') and t.bal(t.pool('USD')) = s.pool_usd - 100 - 70, 'default still pays from the pool');
  perform delete_common_expense(id) from common_expenses where bill_id = b.id;
  perform delete_common_bill(b.id);
  perform t.need(t.bal(c.acct) = 100, 'card back to 100 after cleanup');
  reset role;
end $$;
insert into tres (test) values ('bill paid from card');

-- == Members cannot, archived cards refused
do $$ declare s record; c record; begin
  select * into s from start_state; select * into c from ctx;
  perform t.as_user('member'); set local role authenticated;
  perform t.need(t.try(format($q$select create_common_expense(%L,'Sneaky',1,'USD',null,null,null,null,null,%L)$q$, s.fam, c.acct)) is not null, 'member cannot pay from a card');
  reset role;
  update cards set archived = true where id = c.card;
  perform t.as_user('superadmin'); set local role authenticated;
  perform t.need(t.try(format($q$select create_common_expense(%L,'Archived',1,'USD',null,null,null,null,null,%L)$q$, s.fam, c.acct)) is not null, 'archived card refused');
  reset role;
  update cards set archived = false where id = c.card;
end $$;
insert into tres (test) values ('permissions and archived cards');

-- == Remove the test card and check everything is back
do $$ declare s record; c record; begin
  select * into s from start_state; select * into c from ctx;
  perform t.as_user('superadmin'); set local role authenticated;
  perform delete_transfer(c.topup);
  reset role;
  delete from cards where id = c.card;
  perform t.need((select sum(balance_cache) from wallet_accounts) = s.total, 'family total unchanged');
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd, 'pool USD unchanged');
  perform t.need((select count(*) from common_expenses) = s.ces, 'no leftover common expenses');
  perform t.need((select count(*) from common_bills) = s.bills, 'no leftover bills');
  perform t.need((select count(*) from cards) = s.cards, 'test card removed');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches match entries');
end $$;
insert into tres (test) values ('everything back where it started');

drop schema t cascade;
select n, test, 'PASS' as result from tres union all select 999, 'ALL PAID-FROM-CARD TESTS PASSED', 'OK' order by 1;
