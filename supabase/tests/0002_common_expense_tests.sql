-- ============================================================================
-- Common-expense tests for the Supabase SQL editor (no psql commands).
-- Run on a SCRATCH project only, after 0001-0006. Paste the whole file and press Run.
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
         t.bal(t.pool('USD')) as pool_usd, t.bal(t.pool('LBP')) as pool_lbp,
         (select count(*) from common_expenses) as ces, (select count(*) from common_bills) as bills,
         (select family_id from members where role = 'superadmin' and removed_at is null order by created_at limit 1) as fam;
grant select on start_state to authenticated;
create temp table tres (n serial, test text);

-- == Preflight
do $$ begin
  perform t.need(to_regclass('public.common_expenses') is not null, '0006 is not applied');
  perform t.need(not has_table_privilege('authenticated','common_expenses','INSERT'), 'direct INSERT on common_expenses granted');
  perform t.need(not has_table_privilege('authenticated','common_bills','UPDATE'), 'direct UPDATE on common_bills granted');
  perform t.need(not has_table_privilege('anon','common_expenses','SELECT'), 'anon can read common expenses');
end $$;
insert into tres (test) values ('preflight');

-- == Admin pays common expenses from the pool (USD and LBP)
do $$ declare s record; me uuid; sa uuid; v_lbp_before numeric; ce common_expenses; ce2 common_expenses; sp0 numeric; spm0 numeric; begin
  select * into s from start_state;
  sa := t.mid('superadmin'); me := t.mid('member');
  -- make sure the pool has some LBP to work with
  perform t.as_user('superadmin'); set local role authenticated;
  perform create_deposit(t.pool('LBP'), 2000000, 90000);
  sp0  := period_spend(s.fam, null, null, now() - interval '1 hour');
  spm0 := period_spend(s.fam, me,   null, now() - interval '1 hour');

  ce := create_common_expense(s.fam, 'Electricity', 10, 'USD', null, null, 'test', null, null);
  perform t.need(ce.net_usd = 10 and ce.account_id = t.pool('USD'), 'USD expense recorded against the pool');
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd - 10, 'pool USD dropped by 10, got ' || t.bal(t.pool('USD')));

  v_lbp_before := t.bal(t.pool('LBP'));
  ce2 := create_common_expense(s.fam, 'Generator', 900000, 'LBP', null, 90000, null, me, null);
  perform t.need(ce2.net_usd = 10, 'LBP expense net is 10 USD, got ' || ce2.net_usd);
  perform t.need(t.bal(t.pool('LBP')) = v_lbp_before - 900000, 'pool LBP dropped by 900000');
  perform t.need(ce2.tagged_member_id = me, 'tag saved');
  perform t.need(t.try($q$select create_common_expense((select fam from start_state), 'No rate', 1000, 'LBP', null, null)$q$) is not null, 'LBP without a rate refused');
  perform t.need(t.try($q$select create_common_expense((select fam from start_state), 'Bad rate', 1000, 'LBP', null, 5)$q$) is not null, 'absurd rate refused');
  perform t.need(t.try($q$select create_common_expense((select fam from start_state), 'Euro', 5, 'EUR')$q$) is not null, 'other currencies refused');
  perform t.need(t.try($q$select create_common_expense((select fam from start_state), 'Ghost', 5, 'USD', null, null, null, gen_random_uuid())$q$) is not null, 'unknown tagged member refused');
  perform t.need(t.try($q$select create_common_expense((select fam from start_state), 'Too much', 99999999, 'USD')$q$) is not null, 'overspending the pool refused');

  -- counts toward the family budget, not toward anyone's personal limit
  perform t.need(period_spend(s.fam, null, null, now() - interval '1 hour') = sp0 + 20, 'family spend rose by 20');
  perform t.need(period_spend(s.fam, me, null, now() - interval '1 hour') = spm0, 'member limit spend unchanged (tag is a label only)');
  perform t.need(period_spend(s.fam, sa, null, now() - interval '1 hour') = period_spend(s.fam, sa, null, now() - interval '1 hour'), 'sanity');

  reset role;
  perform t.need(exists (select 1 from wallet_entries where common_expense_id = ce.id and amount = -10), 'ledger entry exists');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches match entries');

  -- clean up the expenses; the pool must come back
  perform t.as_user('superadmin'); set local role authenticated;
  perform delete_common_expense(ce.id); perform delete_common_expense(ce2.id);
  reset role;
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd, 'pool USD restored');
end $$;
insert into tres (test) values ('admin common expenses');

-- == Members and outsiders cannot
do $$ declare s record; ce common_expenses; begin
  select * into s from start_state;
  perform t.as_user('superadmin'); set local role authenticated;
  ce := create_common_expense(s.fam, 'Wifi', 5, 'USD');
  reset role;
  perform t.as_user('member'); set local role authenticated;
  perform t.need(t.try($q$select create_common_expense((select fam from start_state), 'Sneaky', 1, 'USD')$q$) is not null, 'member cannot record');
  perform t.need(t.try(format($q$select delete_common_expense(%L)$q$, ce.id)) is not null, 'member cannot delete');
  perform t.need(t.try($q$insert into common_expenses (family_id,title,amount,currency,net_usd,account_id) values ((select fam from start_state),'x',1,'USD',1,(select t.pool('USD')))$q$) is not null, 'direct insert refused');
  perform t.need(exists (select 1 from common_expenses where id = ce.id), 'member can read it');
  perform t.need(t.try(format($q$select create_common_bill(%L,'x',1,'USD','monthly',current_date)$q$, s.fam)) is not null, 'member cannot add a bill');
  reset role;
  perform t.as_user('superadmin'); set local role authenticated;
  perform delete_common_expense(ce.id);
  reset role;
end $$;
insert into tres (test) values ('permissions');

-- == Recurring bills
do $$ declare s record; b common_bills; b2 common_bills; b3 common_bills; r common_expenses; v_pool numeric; begin
  select * into s from start_state;
  perform t.as_user('superadmin'); set local role authenticated;
  v_pool := t.bal(t.pool('USD'));
  b  := create_common_bill(s.fam, 'Internet', 20, 'USD', 'monthly', date '2026-01-31');
  b2 := create_common_bill(s.fam, 'Water', 5, 'USD', 'weekly', date '2026-03-02');
  b3 := create_common_bill(s.fam, 'Tuition', 30, 'USD', 'one_time', date '2026-05-01', null, t.mid('member'));

  r := pay_common_bill(b.id);
  perform t.need(r.amount = 20 and r.bill_id = b.id and r.title = 'Internet', 'bill paid with its usual amount');
  perform t.need((select next_due_date from common_bills where id = b.id) = date '2026-02-28', 'monthly bill moves to Feb 28, got ' || (select next_due_date from common_bills where id = b.id));
  perform pay_common_bill(b.id, 23.5);
  perform t.need((select next_due_date from common_bills where id = b.id) = date '2026-03-28', 'moves again');
  perform t.need(exists (select 1 from common_expenses where bill_id = b.id and amount = 23.5), 'real amount recorded');
  perform pay_common_bill(b2.id);
  perform t.need((select next_due_date from common_bills where id = b2.id) = date '2026-03-09', 'weekly adds 7 days');
  r := pay_common_bill(b3.id);
  perform t.need(r.tagged_member_id = t.mid('member'), 'tag comes from the bill');
  perform t.need(not (select is_active from common_bills where id = b3.id), 'one-time bill is finished');
  perform t.need(t.try(format($q$select pay_common_bill(%L)$q$, b3.id)) is not null, 'finished bill cannot be paid again');
  perform t.need(t.bal(t.pool('USD')) = v_pool - 20 - 23.5 - 5 - 30, 'pool paid for all four payments');

  -- deleting a bill keeps the expenses it paid
  perform delete_common_bill(b.id);
  perform t.need(exists (select 1 from common_expenses where title = 'Internet'), 'expenses survive bill deletion');
  perform delete_common_bill(b2.id); perform delete_common_bill(b3.id);
  perform delete_common_expense(id) from common_expenses where title in ('Internet','Water','Tuition');
  reset role;
end $$;
insert into tres (test) values ('recurring bills');

-- == Undo the LBP deposit used for the test, then check everything is back
do $$ declare s record; begin
  select * into s from start_state;
  perform t.as_user('superadmin'); set local role authenticated;
  perform delete_deposit(d.id) from deposits d where d.account_id = t.pool('LBP') and d.amount = 2000000 and d.created_at > now() - interval '1 hour';
  reset role;
  perform t.need((select sum(balance_cache) from wallet_accounts) = s.total, 'family total unchanged');
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd, 'pool USD unchanged');
  perform t.need(t.bal(t.pool('LBP')) = s.pool_lbp, 'pool LBP unchanged, got ' || t.bal(t.pool('LBP')));
  perform t.need((select count(*) from common_expenses) = s.ces, 'no leftover common expenses');
  perform t.need((select count(*) from common_bills) = s.bills, 'no leftover bills');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches match entries');
end $$;
insert into tres (test) values ('everything back where it started');

drop schema t cascade;
select n, test, 'PASS' as result from tres union all select 999, 'ALL COMMON-EXPENSE TESTS PASSED', 'OK' order by 1;
