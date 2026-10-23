-- ============================================================================
-- Edit money-in + edit family bill tests for the Supabase SQL editor (no psql commands).
-- Run on a SCRATCH project only, after 0001-0018. Paste the whole file and press Run.
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
create temp table ctx (cat uuid, card_acct uuid, card uuid, ids uuid[], bill uuid);
grant all on ctx to authenticated;

do $$ declare s record; c uuid; k cards; a uuid; begin
  select * into s from start_state;
  insert into categories (family_id, name) values (s.fam, 'Edit test cat') returning id into c;
  perform t.as_user('superadmin'); set local role authenticated;
  k := create_card(s.fam, 'Edit test card', 'USD');
  reset role;
  select id into a from wallet_accounts where card_id = k.id;
  insert into ctx (cat, card_acct, card, ids) values (c, a, k.id, '{}');
end $$;
insert into tres (test) values ('setup');

-- member edits own wallet record
do $$ declare s record; c record; me uuid; d deposits; w0 numeric; r jsonb; sp0 numeric; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  w0 := t.bal(t.wallet(me,'USD'));
  perform t.as_user('member'); set local role authenticated;
  d := create_income(t.wallet(me,'USD'), 100, 'salary', null, null, 'pay');
  update ctx set ids = ids || d.id;
  -- amount, kind, note, date
  d := update_income(d.id, 150, 'bonus', null, null, '  big pay ', now() - interval '3 days');
  perform t.need(d.amount = 150 and d.kind = 'bonus' and d.note = 'big pay' and d.created_at < now() - interval '2 days', 'fields updated');
  reset role;
  perform t.need(t.bal(t.wallet(me,'USD')) = w0 + 150, 'wallet follows the new amount');
  perform t.need((select amount from wallet_entries where deposit_id = d.id) = 150, 'ledger entry follows');
  perform t.need((select created_at from wallet_entries where deposit_id = d.id) = d.created_at, 'ledger date follows');
  perform t.as_user('member'); set local role authenticated;
  -- becomes a reimbursement: needs category, then lowers spending
  perform t.need(t.try(format($q$select update_income(%L,150,'reimbursement')$q$, d.id)) is not null, 'reimbursement needs a category');
  sp0 := (spend_rollup(s.fam, null, null, me)->>'total')::numeric;
  d := update_income(d.id, 150, 'reimbursement', null, c.cat);
  r := spend_rollup(s.fam, null, null, me);
  perform t.need((r->>'total')::numeric = sp0 - 150, 'edited into a reimbursement lowers spending');
  -- back to salary clears the category
  d := update_income(d.id, 150, 'salary', null, c.cat);
  perform t.need(d.category_id is null, 'category cleared when no longer a reimbursement');
  perform t.need((spend_rollup(s.fam, null, null, me)->>'total')::numeric = sp0, 'spending back');
  -- refusals
  perform t.need(t.try(format($q$select update_income(%L,0,'salary')$q$, d.id)) is not null, 'zero refused');
  perform t.need(t.try(format($q$select update_income(%L,10,'bogus')$q$, d.id)) is not null, 'unknown kind refused');
  perform t.need(t.try(format($q$select update_income(%L,10,'salary',null,null,null,now() + interval '2 days')$q$, d.id)) is not null, 'future date refused');
  perform t.need(t.try(format($q$select update_income(%L,10,'salary')$q$, gen_random_uuid())) is not null, 'missing record refused');
  reset role;
  -- member cannot edit someone else's record
  perform t.as_user('superadmin'); set local role authenticated;
  d := create_income(t.wallet(t.mid('superadmin'),'USD'), 20, 'gift');
  update ctx set ids = ids || d.id;
  reset role;
  perform t.as_user('member'); set local role authenticated;
  perform t.need(t.try(format($q$select update_income(%L,30,'gift')$q$, d.id)) is not null, 'member cannot edit the admin record');
  reset role;
  -- admin can edit the member record
  perform t.as_user('superadmin'); set local role authenticated;
  perform t.need(t.try(format($q$select update_income(%L,160,'salary')$q$, (select ids[1] from ctx))) is null, 'admin can edit a member record');
  reset role;
  perform t.need(t.bal(t.wallet(me,'USD')) = w0 + 160, 'balance after admin edit');
end $$;
insert into tres (test) values ('edit own wallet money-in; rules');

-- non-negative balance: lowering a record that was already spent is refused
do $$ declare s record; c record; me uuid; d deposits; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('superadmin'); set local role authenticated;
  d := create_income(c.card_acct, 50, 'other');
  update ctx set ids = ids || d.id;
  perform t.need(t.try(format($q$select update_income(%L,40,'other')$q$, d.id)) is null, 'lowering with room left works');
  perform t.need(t.try(format($q$select create_card_spend(%L,35,'edit-spend')$q$, c.card)) is null, 'spend 35 from the card');
  perform t.need(t.try(format($q$select update_income(%L,30,'other')$q$, d.id)) is not null, 'cannot lower below what was spent');
  reset role;
  perform t.need(t.bal(c.card_acct) = 5, 'card balance unchanged by the refused edit');
  delete from card_transactions where note = 'edit-spend';
  update wallet_accounts set balance_cache = (select coalesce(sum(amount),0) from wallet_entries where account_id = c.card_acct) where id = c.card_acct;
end $$;
insert into tres (test) values ('cannot edit a record below what was spent');

-- pool / card: beneficiary, admin only
do $$ declare s record; c record; me uuid; d deposits; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('superadmin'); set local role authenticated;
  d := create_income(c.card_acct, 70, 'reimbursement', null, c.cat, null, null, me);
  update ctx set ids = ids || d.id;
  perform t.need(d.beneficiary_member_id = me, 'tagged to the member');
  d := update_income(d.id, 60, 'reimbursement', null, c.cat, null, null, t.mid('superadmin'));
  perform t.need(d.beneficiary_member_id = t.mid('superadmin') and d.amount = 60, 'who it counts for can change');
  d := update_income(d.id, 60, 'reimbursement', null, c.cat, null, null, null);
  perform t.need(d.beneficiary_member_id is null, 'tag can be cleared');
  perform t.need(t.try(format($q$select update_income(%L,60,'gift',null,null,null,null,%L)$q$, d.id, gen_random_uuid())) is not null, 'unknown person refused');
  reset role;
  -- an own-wallet record ignores a beneficiary argument
  perform t.as_user('member'); set local role authenticated;
  d := create_income(t.wallet(me,'USD'), 5, 'gift');
  update ctx set ids = ids || d.id;
  d := update_income(d.id, 6, 'gift', null, null, null, null, t.mid('superadmin'));
  perform t.need(d.beneficiary_member_id = me, 'own wallet stays with its owner');
  perform t.need(t.try(format($q$select update_income(%L,6,'gift')$q$, (select ids[array_length(ids,1)-1] from ctx))) is not null, 'member cannot edit pool/card money');
  reset role;
end $$;
insert into tres (test) values ('who it counts for on pool/card money');

-- LBP rate
do $$ declare s record; c record; me uuid; d deposits; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('member'); set local role authenticated;
  d := create_income(t.wallet(me,'LBP'), 900000, 'gift', 90000);
  update ctx set ids = ids || d.id;
  d := update_income(d.id, 1800000, 'gift');
  perform t.need(d.amount = 1800000 and round(1 / d.exchange_rate_to_base) = 90000, 'rate kept when not given');
  perform t.need(t.try(format($q$select update_income(%L,1800000,'gift',1)$q$, d.id)) is not null, 'silly new rate refused');
  reset role;
end $$;
insert into tres (test) values ('LBP edit keeps its rate');

-- family bills
do $$ declare s record; c record; me uuid; b common_bills; begin
  select * into s from start_state; select * into c from ctx; me := t.mid('member');
  perform t.as_user('superadmin'); set local role authenticated;
  b := create_common_bill(s.fam, 'Edit test bill', 50, 'USD', 'monthly', current_date + 5);
  update ctx set bill = b.id;
  b := update_common_bill(b.id, '  Electricity ', 75, 'LBP', 'weekly', current_date + 9, c.cat, me);
  perform t.need(b.name = 'Electricity' and b.amount = 75 and b.currency = 'LBP' and b.recurrence = 'weekly'
                 and b.next_due_date = current_date + 9 and b.category_id = c.cat and b.tagged_member_id = me, 'bill fields updated');
  perform t.need(t.try(format($q$select update_common_bill(%L,'',1,'USD','monthly',current_date)$q$, b.id)) is not null, 'empty name refused');
  perform t.need(t.try(format($q$select update_common_bill(%L,'x',0,'USD','monthly',current_date)$q$, b.id)) is not null, 'zero refused');
  perform t.need(t.try(format($q$select update_common_bill(%L,'x',1,'EUR','monthly',current_date)$q$, b.id)) is not null, 'bad currency refused');
  perform t.need(t.try(format($q$select update_common_bill(%L,'x',1,'USD','yearly',current_date)$q$, b.id)) is not null, 'bad repeat refused');
  perform t.need(t.try(format($q$select update_common_bill(%L,'x',1,'USD','monthly',null)$q$, b.id)) is not null, 'missing date refused');
  perform t.need(t.try(format($q$select update_common_bill(%L,'x',1,'USD','monthly',current_date,%L)$q$, b.id, gen_random_uuid())) is not null, 'unknown category refused');
  perform t.need(t.try(format($q$select update_common_bill(%L,'x',1,'USD','monthly',current_date,null,%L)$q$, b.id, gen_random_uuid())) is not null, 'unknown person refused');
  reset role;
  perform t.as_user('member'); set local role authenticated;
  perform t.need(t.try(format($q$select update_common_bill(%L,'x',1,'USD','monthly',current_date)$q$, b.id)) is not null, 'member cannot edit a family bill');
  reset role;
end $$;
insert into tres (test) values ('edit family bill; admin only');

-- cleanup
do $$ declare s record; c record; i uuid; begin
  select * into s from start_state; select * into c from ctx;
  perform t.as_user('superadmin'); set local role authenticated;
  perform delete_common_bill(c.bill);
  for i in select x from ctx, unnest(ids) with ordinality as u(x, n) order by n desc loop
    if exists (select 1 from deposits where id = i) then perform delete_income(i); end if;
  end loop;
  reset role;
  delete from wallet_accounts where card_id = c.card;
  delete from cards where id = c.card;
  delete from categories where id = c.cat;
  perform t.need((select sum(balance_cache) from wallet_accounts) = s.total, 'family total unchanged');
  perform t.need((select count(*) from deposits) = s.deposits, 'no leftover deposits');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches match entries');
end $$;
insert into tres (test) values ('everything back where it started');

drop schema t cascade;
select n, test, 'PASS' as result from tres union all select 999, 'ALL EDIT TESTS PASSED', 'OK' order by 1;
