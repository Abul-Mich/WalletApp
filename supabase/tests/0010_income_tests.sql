-- ============================================================================
-- Income tests for the Supabase SQL editor (no psql commands).
-- Run on a SCRATCH project only, after 0001-0014. Paste the whole file and press Run.
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
         t.bal(t.pool('USD')) as pool_usd, (select count(*) from deposits) as deposits,
         (select family_id from members where role = 'superadmin' and removed_at is null order by created_at limit 1) as fam;
grant select on start_state to authenticated;
create temp table tres (n serial, test text);
create temp table ctx (cat uuid, card_acct uuid, card uuid, pk uuid, pk_acct uuid, apk uuid, spend0 numeric, inc0 numeric, w0 numeric, ids uuid[]);
grant all on ctx to authenticated;

do $$ declare s record; c uuid; k cards; a uuid; me uuid; r jsonb; begin
  select * into s from start_state; me := t.mid('member');
  insert into categories (family_id, name) values (s.fam, 'Income test cat') returning id into c;
  perform t.as_user('superadmin'); set local role authenticated;
  k := create_card(s.fam, 'Income test card', 'USD');
  reset role;
  select id into a from wallet_accounts where card_id = k.id;
  r := spend_rollup(s.fam, null, null, me);
  insert into ctx (cat, card_acct, card, spend0, inc0, w0, ids) values (c, a, k.id, (r->>'total')::numeric, (r->>'income')::numeric, t.bal(t.wallet(me,'USD')), '{}');
end $$;
insert into tres (test) values ('setup');

-- member: salary and gift into own wallet, rules
do $$ declare s record; c record; me uuid; d deposits; r jsonb; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('member'); set local role authenticated;
  d := create_income(t.wallet(me,'USD'), 100, 'salary', null, null, '  October pay ');
  update ctx set ids = ids || d.id;
  perform t.need(d.kind = 'salary' and d.beneficiary_member_id = me and d.note = 'October pay', 'row stored with kind, owner, trimmed note');
  d := create_income(t.wallet(me,'USD'), 30, 'gift');
  update ctx set ids = ids || d.id;
  perform t.need(t.try(format($q$select create_income(%L,10,'bogus')$q$, t.wallet(me,'USD'))) is not null, 'unknown kind refused');
  perform t.need(t.try(format($q$select create_income(%L,0,'salary')$q$, t.wallet(me,'USD'))) is not null, 'zero refused');
  perform t.need(t.try(format($q$select create_income(%L,10,'salary')$q$, t.pool('USD'))) is not null, 'member cannot add to the pool');
  perform t.need(t.try(format($q$select create_income(%L,10,'salary')$q$, c.card_acct)) is not null, 'member cannot add to a card');
  perform t.need(t.try(format($q$select create_income(%L,10,'salary')$q$, t.wallet(t.mid('superadmin'),'USD'))) is not null, 'member cannot add to someone else');
  perform t.need(t.try(format($q$select create_income(%L,10,'reimbursement')$q$, t.wallet(me,'USD'))) is not null, 'reimbursement needs a category');
  perform t.need(t.try(format($q$select create_income(%L,10,'reimbursement',null,%L)$q$, t.wallet(me,'USD'), gen_random_uuid())) is not null, 'reimbursement needs a real category');
  perform t.need(t.try(format($q$select create_income(%L,1000,'salary',null)$q$, t.wallet(me,'LBP'))) is not null, 'LBP needs a rate');
  perform t.need(t.try(format($q$select create_income(%L,10,'salary',null,null,null,now() + interval '2 days')$q$, t.wallet(me,'USD'))) is not null, 'future date refused');
  reset role;
  perform t.need(t.bal(t.wallet(me,'USD')) = c.w0 + 130, 'wallet gained 130');
  r := spend_rollup(s.fam, null, null, me);
  perform t.need((r->>'income')::numeric = c.inc0 + 130, 'income counts salary and gift');
  perform t.need((r->>'total')::numeric = c.spend0, 'income does not change spending');
end $$;
insert into tres (test) values ('member adds income to own wallet; other routes refused');

-- reimbursement lowers spending, is not income
do $$ declare s record; c record; me uuid; d deposits; r jsonb; cats jsonb; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('member'); set local role authenticated;
  d := create_income(t.wallet(me,'USD'), 40, 'reimbursement', null, c.cat);
  update ctx set ids = ids || d.id;
  r := spend_rollup(s.fam, null, null, me);
  reset role;
  perform t.need((r->>'total')::numeric = c.spend0 - 40, 'spending total dropped by 40');
  perform t.need((r->>'income')::numeric = c.inc0 + 130, 'reimbursement is not income');
  cats := r->'categories';
  perform t.need(exists (select 1 from jsonb_array_elements(cats) e where e->>'kind' = 'reimbursement' and (e->>'category_id')::uuid = c.cat and (e->>'total')::numeric = -40), 'category row shows -40');
  perform t.need(t.bal(t.wallet(me,'USD')) = c.w0 + 170, 'money arrived in the wallet');
end $$;
insert into tres (test) values ('reimbursement lowers its category and spending');

-- pockets and privacy
do $$ declare s record; c record; me uuid; p pockets; d deposits; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('member'); set local role authenticated;
  p := create_pocket(s.fam, 'Income pocket', 'USD');
  d := create_income((select id from wallet_accounts where pocket_id = p.id), 25, 'bonus');
  update ctx set pk = p.id, pk_acct = (select id from wallet_accounts where pocket_id = p.id), ids = ids || d.id;
  perform t.need(d.beneficiary_member_id = me, 'pocket income belongs to its owner');
  reset role;
  -- the admin's own pocket income is invisible to the member
  perform t.as_user('superadmin'); set local role authenticated;
  p := create_pocket(s.fam, 'Admin income pocket', 'USD');
  d := create_income((select id from wallet_accounts where pocket_id = p.id), 15, 'gift');
  update ctx set apk = p.id, ids = ids || d.id;
  perform t.need(exists (select 1 from deposits where id = (select ids[array_length(ids,1)] from ctx)), 'admin sees own pocket income');
  reset role;
  perform t.as_user('member'); set local role authenticated;
  perform t.need(not exists (select 1 from deposits where id = (select ids[array_length(ids,1)] from ctx)), 'member cannot see the admin pocket income');
  perform t.need(exists (select 1 from deposits where id = (select ids[array_length(ids,1) - 1] from ctx)), 'member sees own pocket income');
  reset role;
end $$;
insert into tres (test) values ('income into pockets, private to the owner');

-- admin: pool and card; deleting
do $$ declare s record; c record; me uuid; d deposits; d2 deposits; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('superadmin'); set local role authenticated;
  d := create_income(t.pool('USD'), 200, 'gift');
  update ctx set ids = ids || d.id;
  d2 := create_income(c.card_acct, 80, 'other', null, null, 'cash top-up');
  update ctx set ids = ids || d2.id;
  perform t.need(d.beneficiary_member_id is null and d2.beneficiary_member_id is null, 'pool and card income have no member owner');
  perform t.need(t.try(format($q$select delete_income(%L)$q$, (select ids[1] from ctx))) is null, 'admin can delete a member income record');
  reset role;
  perform t.need(t.bal(c.card_acct) = 80 and t.bal(t.pool('USD')) = s.pool_usd + 200, 'card and pool balances');
  perform t.as_user('member'); set local role authenticated;
  perform t.need(t.try(format($q$select delete_income(%L)$q$, d.id)) is not null, 'member cannot delete the admin record');
  reset role;
end $$;
insert into tres (test) values ('admin adds to pool and card; delete rules');

-- cleanup
do $$ declare s record; c record; me uuid; i uuid; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('superadmin'); set local role authenticated;
  for i in select x from ctx, unnest(ids) with ordinality as u(x, n) order by n desc loop
    if exists (select 1 from deposits where id = i) then perform delete_income(i); end if;
  end loop;
  reset role;
  delete from pockets where id in (c.pk, c.apk);
  delete from wallet_accounts where card_id = c.card;
  delete from cards where id = c.card;
  delete from categories where id = c.cat;
  perform t.need((select sum(balance_cache) from wallet_accounts) = s.total, 'family total unchanged');
  perform t.need((select count(*) from deposits) = s.deposits, 'no leftover deposits');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches match entries');
end $$;
insert into tres (test) values ('everything back where it started');

drop schema t cascade;
select n, test, 'PASS' as result from tres union all select 999, 'ALL INCOME TESTS PASSED', 'OK' order by 1;
