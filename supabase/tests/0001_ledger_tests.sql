-- ============================================================================
-- Ledger tests for the Supabase SQL editor (no psql commands).
-- Run on a SCRATCH project only, after 0001-0004, with a copy of the real data.
-- Paste the whole file and press Run. Any failure shows an error that starts
-- with "TEST FAILED" (and the whole run is rolled back, so nothing is left behind).
-- On success the result grid lists every test group with PASS.
-- Test records are created and removed again (exact balances are asserted);
-- a few notification rows stay in the scratch project. The script can be run again.
-- Needs three members: a superadmin, an admin and a member (as in your data).
-- ============================================================================

create schema t;
grant usage on schema t to authenticated;

-- try(sql): returns NULL if the statement succeeded, else the error message
create function t.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- Supabase's auth.uid() reads the JWT claims, so we set those
create function t.as_uid(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
end $$;

create function t.as_user(p_member text) returns void language plpgsql as $$
begin
  perform t.as_uid((select user_id from members where role = p_member and removed_at is null order by created_at limit 1));
end $$;

create function t.mid(p_role text) returns uuid language sql as $$
  select id from members where role = p_role and removed_at is null order by created_at limit 1 $$;
create function t.acct(p_member uuid, p_cur text) returns uuid language sql as $$
  select id from wallet_accounts where member_id = p_member and currency = p_cur $$;
create function t.pool(p_cur text) returns uuid language sql as $$
  select id from wallet_accounts where owner_kind = 'pool' and currency = p_cur limit 1 $$;
create function t.bal(p_acct uuid) returns numeric language sql as $$
  select balance_cache from wallet_accounts where id = p_acct $$;
create function t.need(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'TEST FAILED: %', p_msg; end if; end $$;
grant execute on all functions in schema t to authenticated;

-- remember the starting numbers
create temp table start_state as
  select (select sum(balance_cache) from wallet_accounts)                      as total,
         (select count(*) from wallet_entries)                                 as entries,
         (select count(*) from transactions)                                   as txns,
         t.bal(t.pool('USD'))                                                  as pool_usd,
         t.bal(t.acct(t.mid('superadmin'),'USD'))                              as sa_usd,
         t.bal(t.acct(t.mid('member'),'USD'))                                  as me_usd;
grant select on start_state to authenticated;

create temp table tres (n serial, test text);

-- == Preflight: cutover (0004) is really applied
do $$ begin
  perform t.need(not has_table_privilege('authenticated','members','UPDATE'), 'authenticated still has table-wide UPDATE on members');
  perform t.need(has_column_privilege('authenticated','members','display_name','UPDATE'), 'display_name should stay editable');
  perform t.need(not has_column_privilege('authenticated','members','role','UPDATE'), 'role must not be editable');
  perform t.need(not has_column_privilege('authenticated','members','spending_limit_amount','UPDATE'), 'limit must not be editable');
  perform t.need(not has_table_privilege('authenticated','transactions','INSERT'), 'direct INSERT on transactions still granted');
  perform t.need(not has_table_privilege('authenticated','deposits','INSERT'), 'direct INSERT on deposits still granted');
  perform t.need(not has_table_privilege('anon','wallet_accounts','SELECT'), 'anon can read wallets');
  perform t.need(not exists (select 1 from pg_trigger where tgname in ('trg_transactions_check_balance','trg_transactions_recalc','trg_transactions_recalc_member_balance','trg_card_transaction') and not tgisinternal),
                 'old balance triggers still present');
end $$;
insert into tres (test) values ('preflight');

-- == Reconciliation
do $$ begin
  perform t.need(not exists (select 1 from wallet_accounts a
     where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)),
     'balance_cache differs from entries');
  perform t.need(not exists (select 1 from transactions x where x.net_usd is null
     or abs(x.net_usd + (select coalesce(sum(amount),0) from transaction_legs l where l.transaction_id = x.id)) > 0.0001
        and x.lbp_per_usd is null), 'net_usd differs from legs (USD-only expenses)');
  perform t.need(not exists (select 1 from wallet_accounts where balance_cache < 0), 'a wallet is negative');
end $$;
insert into tres (test) values ('reconciliation');

-- == Worked example: pay USD 10 + LBP 900,000, change USD 5 + LBP 100,000, rate 90,000
do $$
declare v_me uuid := t.mid('superadmin'); s record; r record; v_lbp uuid; v_usd uuid; x transactions; d deposits;
begin
  perform t.as_user('superadmin'); set local role authenticated;
  v_lbp := t.acct(v_me,'LBP'); v_usd := t.acct(v_me,'USD');
  -- fund the LBP wallet by a deposit into the member's own wallet
  d := create_deposit(v_lbp, 1000000, 90000);
  perform t.need(t.bal(v_lbp) = 1000000, 'LBP deposit');
  select sa_usd into s from start_state;
  x := create_expense(v_me, null, 'worked example',
        '[{"currency":"USD","amount":-10},{"currency":"LBP","amount":-900000},{"currency":"USD","amount":5},{"currency":"LBP","amount":100000}]'::jsonb, 90000);
  perform t.need(t.bal(v_usd) = s.sa_usd - 5, 'USD wallet should be down 5');
  perform t.need(t.bal(v_lbp) = 200000,        'LBP wallet should be 200,000');
  perform t.need(x.net_usd = round(5 + 800000/90000.0, 4), 'net_usd should be 13.8889, got ' || x.net_usd);
  perform t.need(x.created_at is not null, 'date is stored');
  -- edit to a different split, then delete: wallets return to the exact earlier balances
  x := update_expense(x.id, null, 'edited', '[{"currency":"LBP","amount":-90000}]'::jsonb, 90000);
  perform t.need(t.bal(v_usd) = s.sa_usd and t.bal(v_lbp) = 910000 and x.net_usd = 1, 'after edit: USD same, LBP 910,000, net 1');
  perform delete_expense(x.id);
  perform t.need(t.bal(v_usd) = s.sa_usd and t.bal(v_lbp) = 1000000, 'after delete: balances back');
  perform delete_deposit(d.id);
  perform t.need(t.bal(v_lbp) = 0, 'test deposit removed');
  reset role;
end $$;
insert into tres (test) values ('worked example, edit, delete');

-- == LBP only, USD change
do $$
declare v_me uuid := t.mid('superadmin'); v_lbp uuid := t.acct(t.mid('superadmin'),'LBP'); v_usd uuid := t.acct(t.mid('superadmin'),'USD');
        u0 numeric; l0 numeric; x transactions; d deposits;
begin
  perform t.as_user('superadmin'); set local role authenticated;
  d := create_deposit(v_lbp, 1000000, 90000);
  u0 := t.bal(v_usd); l0 := t.bal(v_lbp);
  x := create_expense(v_me, null, 'lbp pay', '[{"currency":"LBP","amount":-450000},{"currency":"USD","amount":1}]'::jsonb, 90000);
  perform t.need(t.bal(v_lbp) = l0 - 450000 and t.bal(v_usd) = u0 + 1, 'LBP down, USD up');
  perform t.need(x.net_usd = 4, 'net 450000/90000 - 1 = 4, got ' || x.net_usd);
  perform delete_expense(x.id);
  perform t.need(t.bal(v_lbp) = l0 and t.bal(v_usd) = u0, 'restored');
  perform delete_deposit(d.id);
  reset role;
end $$;
insert into tres (test) values ('LBP-only payment');

-- == Rules
do $$
declare v_me uuid := t.mid('member'); n0 int; msg text; a uuid := t.acct(t.mid('member'),'USD');
begin
  perform t.as_user('member'); set local role authenticated;
  select count(*) into n0 from transactions;
  msg := t.try(format($f$select create_expense(%L, null, 'too much', '[{"currency":"USD","amount":-1000000}]'::jsonb)$f$, v_me));
  perform t.need(msg like '%Not enough balance%', 'overspend must be rejected, got: ' || coalesce(msg,'(accepted!)'));
  perform t.need((select count(*) from transactions) = n0, 'rejected expense must not be saved');
  msg := t.try(format($f$select create_transfer(%L, %L, 1)$f$, a, t.acct(t.mid('member'),'LBP')));
  perform t.need(msg like '%same currency%', 'cross-currency transfer rejected, got: ' || coalesce(msg,'(accepted!)'));
  msg := t.try(format($f$select create_exchange(%L, %L, 1, 1)$f$, a, t.pool('USD')));
  perform t.need(msg is not null, 'exchange into someone else''s/pool wallet rejected');
  msg := t.try(format($f$select create_exchange(%L, %L, 1, 1)$f$, t.pool('USD'), t.pool('LBP')));
  perform t.need(msg like '%Only admins%', 'member cannot exchange in pool, got: ' || coalesce(msg,'(accepted!)'));
  msg := t.try(format($f$select create_expense(%L, null, 'x', '[{"currency":"USD","amount":-1}]'::jsonb)$f$, t.mid('admin')));
  perform t.need(msg like '%own expenses%', 'member cannot add expenses for others');
  reset role;
end $$;
insert into tres (test) values ('balance, currency and permission rules');

-- == Money cannot be created by a member
do $$
declare me uuid := t.mid('member'); u uuid := t.acct(t.mid('member'),'USD'); l uuid := t.acct(t.mid('member'),'LBP'); msg text;
begin
  perform t.as_user('member'); set local role authenticated;
  msg := t.try(format($f$select create_deposit(%L, 1000000)$f$, u));
  perform t.need(msg like '%Only admins%', 'member deposit must be refused, got: ' || coalesce(msg,'(accepted!)'));
  msg := t.try(format($f$select create_exchange(%L, %L, 1, 1e15)$f$, u, l));
  perform t.need(msg like '%rate%', 'absurd exchange rate refused, got: ' || coalesce(msg,'(accepted!)'));
  msg := t.try(format($f$select create_exchange(%L, %L, 1, 50000)$f$, u, l));
  perform t.need(msg like '%10 percent%', 'exchange 10 percent off the family rate refused, got: ' || coalesce(msg,'(accepted!)'));
  msg := t.try(format($f$select create_expense(%L, null, 'mint', '[{"currency":"USD","amount":-5},{"currency":"LBP","amount":9000000000}]'::jsonb, 10000000)$f$, me));
  perform t.need(msg like '%rate%', 'expense with a minting rate refused, got: ' || coalesce(msg,'(accepted!)'));
  reset role;
end $$;
insert into tres (test) values ('no money creation by members');

-- == Transfers both ways, pool never negative
do $$
declare me uuid := t.mid('member'); mu uuid := t.acct(t.mid('member'),'USD'); p uuid := t.pool('USD'); p0 numeric; m0 numeric; r transfers; r2 transfers; msg text;
begin
  perform t.as_user('member'); set local role authenticated;
  p0 := t.bal(p); m0 := t.bal(mu);
  r := create_transfer(p, mu, 5);                 -- pool -> own wallet
  perform t.need(t.bal(p) = p0 - 5 and t.bal(mu) = m0 + 5, 'pool to member');
  r2 := create_transfer(mu, p, 5);                -- own wallet -> pool
  perform t.need(t.bal(p) = p0 and t.bal(mu) = m0, 'member back to pool');
  msg := t.try(format($f$select create_transfer(%L, %L, %s)$f$, p, mu, p0 + 1));
  perform t.need(msg like '%Not enough balance%', 'cannot draw more than the pool holds, got: ' || coalesce(msg,'(accepted!)'));
  msg := t.try(format($f$select delete_transfer(%L)$f$, r.id));
  perform t.need(msg like '%Only admins%', 'member cannot delete a transfer');
  reset role;
  perform t.as_user('admin'); set local role authenticated;
  perform delete_transfer(r2.id);                 -- admin removes both test transfers; entries cascade
  perform delete_transfer(r.id);
  reset role;
  perform t.need(t.bal(p) = p0 and t.bal(mu) = m0, 'transfers removed, balances back');
end $$;
insert into tres (test) values ('transfers');

-- == Exchange between own wallets
do $$
declare me uuid := t.mid('superadmin'); u uuid := t.acct(t.mid('superadmin'),'USD'); l uuid := t.acct(t.mid('superadmin'),'LBP');
        u0 numeric; l0 numeric; e exchanges;
begin
  perform t.as_user('superadmin'); set local role authenticated;
  u0 := t.bal(u); l0 := t.bal(l);
  e := create_exchange(u, l, 10, 900000);
  perform t.need(t.bal(u) = u0 - 10 and t.bal(l) = l0 + 900000 and e.lbp_per_usd = 90000, 'exchange amounts and stored rate');
  perform delete_exchange(e.id);
  perform t.need(t.bal(u) = u0 and t.bal(l) = l0, 'exchange removed');
  reset role;
end $$;
insert into tres (test) values ('exchange');

-- == Security: direct writes and role/limit changes are refused
do $$
declare msg text; me uuid := t.mid('member'); fam uuid := (select family_id from members limit 1);
begin
  perform t.as_user('member'); set local role authenticated;
  msg := t.try(format($f$update members set spending_limit_amount = 9999 where id = %L$f$, me));
  perform t.need(msg like '%permission denied%', 'member limit update must be denied, got: ' || coalesce(msg,'(accepted!)'));
  msg := t.try(format($f$update members set role = 'admin' where id = %L$f$, me));
  perform t.need(msg like '%permission denied%', 'member role update must be denied, got: ' || coalesce(msg,'(accepted!)'));
  msg := t.try(format($f$update members set balance = 9999 where id = %L$f$, me));
  perform t.need(msg like '%permission denied%', 'balance update denied');
  msg := t.try(format($f$insert into transactions (family_id, member_id, amount, currency, exchange_rate_to_base) values (%L, %L, 1, 'USD', 1)$f$, fam, me));
  perform t.need(msg like '%permission denied%', 'direct transaction insert denied, got: ' || coalesce(msg,'(accepted!)'));
  msg := t.try(format($f$insert into wallet_entries (account_id, amount, deposit_id) values (%L, 5, gen_random_uuid())$f$, t.acct(me,'USD')));
  perform t.need(msg like '%permission denied%', 'direct entry insert denied');
  msg := t.try(format($f$insert into deposits (family_id, added_by_member_id, amount, currency) values (%L, %L, 5, 'USD')$f$, fam, me));
  perform t.need(msg like '%permission denied%', 'direct deposit insert denied');
  msg := t.try(format($f$update wallet_accounts set balance_cache = 1e9 where id = %L$f$, t.acct(me,'USD')));
  perform t.need(msg like '%permission denied%', 'balance_cache update denied');
  msg := t.try(format($f$delete from members where id = %L$f$, t.mid('admin')));
  perform t.need(msg like '%permission denied%', 'member delete denied');
  reset role;
end $$;
insert into tres (test) values ('direct writes refused');

-- == Security: other members records
do $$
declare msg text; x transactions; sa uuid := t.mid('superadmin');
begin
  perform t.as_user('superadmin'); set local role authenticated;
  x := create_expense(sa, null, 'sa expense', '[{"currency":"USD","amount":-1}]'::jsonb);
  reset role;
  perform t.as_user('member'); set local role authenticated;
  msg := t.try(format($f$select update_expense(%L, null, 'hack', '[{"currency":"USD","amount":-1}]'::jsonb)$f$, x.id));
  perform t.need(msg like '%own expenses%', 'member cannot edit another member''s expense');
  msg := t.try(format($f$select delete_expense(%L)$f$, x.id));
  perform t.need(msg like '%own expenses%', 'member cannot delete another member''s expense');
  reset role;
  perform t.as_user('admin'); set local role authenticated;
  perform delete_expense(x.id);                    -- admin may
  reset role;
end $$;
insert into tres (test) values ('ownership');

-- == Security: non-member, invites, joining, removal
do $$
declare msg text; fam uuid := (select family_id from members limit 1); outsider uuid := gen_random_uuid(); n int;
        i family_invites; m members; mem uuid := t.mid('member'); p uuid := t.pool('USD'); mu uuid := t.acct(t.mid('member'),'USD');
begin
  -- leftovers from an earlier run (the test user and its test member) are removed first
  delete from auth.users where email like 'outsider-%@test.invalid';
  insert into auth.users (id, email) values (outsider, 'outsider-' || outsider || '@test.invalid');
  perform t.as_uid(outsider); set local role authenticated;
  msg := t.try(format($f$insert into members (family_id, user_id, display_name) values (%L, %L, 'x')$f$, fam, outsider));
  perform t.need(msg like '%permission denied%', 'outsider cannot insert a member row, got: ' || coalesce(msg,'(accepted!)'));
  select count(*) into n from family_invites;
  perform t.need(n = 0, 'outsider must not see invite codes');
  select count(*) into n from wallet_accounts;
  perform t.need(n = 0, 'outsider must not see wallets');
  msg := t.try($f$select join_family('not-a-real-code', 'Eve')$f$);
  perform t.need(msg like '%invalid, used or expired%', 'bad code refused');
  msg := t.try($f$select create_invite((select family_id from members limit 1))$f$);
  perform t.need(msg is not null, 'outsider cannot create invites');
  reset role;

  perform t.as_user('admin'); set local role authenticated;
  i := create_invite(fam);
  reset role;
  perform t.as_user('member'); set local role authenticated;
  perform t.need((select count(*) from family_invites) = 0, 'plain member must not list invites');
  reset role;
  perform t.as_uid(outsider); set local role authenticated;
  m := join_family(i.code, 'New Person');
  perform t.need(m.role = 'member' and exists (select 1 from wallet_accounts where member_id = m.id and currency = 'USD')
                 and exists (select 1 from wallet_accounts where member_id = m.id and currency = 'LBP'), 'joined as member with both wallets');
  msg := t.try(format($f$select join_family(%L, 'again')$f$, i.code));
  perform t.need(msg is not null, 'a used code cannot be used again');
  reset role;
  -- removal: refused while the member holds money, allowed at zero; history is kept
  perform t.as_user('admin'); set local role authenticated;
  msg := t.try(format($f$select remove_member(%L)$f$, mem));
  perform t.need(msg like '%still holds money%', 'removal refused while wallets are not empty, got: ' || coalesce(msg,'(accepted!)'));
  perform remove_member(m.id);                      -- the new person holds nothing
  reset role;
  perform t.need((select removed_at is not null from members where id = m.id), 'removed_at set');
  perform t.as_uid(outsider); set local role authenticated;
  perform t.need((select count(*) from wallet_accounts) = 0, 'removed member sees nothing');
  reset role;
  perform t.as_user('superadmin'); set local role authenticated;
  msg := t.try(format($f$select remove_member(%L)$f$, t.mid('superadmin')));
  perform t.need(msg like '%cannot be removed%', 'superadmin cannot be removed');
  msg := t.try(format($f$select set_role(%L, 'admin')$f$, mem));
  perform t.need(msg is null, 'superadmin can change a role');
  perform set_role(mem, 'member');
  reset role;
  perform t.as_user('admin'); set local role authenticated;
  msg := t.try(format($f$select set_role(%L, 'admin')$f$, mem));
  perform t.need(msg like '%Only the superadmin%', 'admin cannot change roles');
  reset role;
  delete from auth.users where id = outsider;     -- clean up the test user (its removed test member goes with it)
end $$;
insert into tres (test) values ('identity and invites');

-- == Limits: card spending and expenses both count, Monday week in Asia/Beirut
do $$
declare fam uuid := (select family_id from members limit 1); sa uuid := t.mid('superadmin'); w0 numeric; w1 numeric; k cards; c card_transactions; x transactions;
        ps timestamptz; tr transfers;
begin
  perform t.as_user('superadmin'); set local role authenticated;
  ps := period_start('weekly');
  perform t.need(extract(isodow from ps at time zone 'Asia/Beirut') = 1 and (ps at time zone 'Asia/Beirut')::time = '00:00', 'week starts Monday 00:00 Beirut');
  perform t.need(extract(day from period_start('monthly') at time zone 'Asia/Beirut') = 1, 'month starts on the 1st');
  w0 := period_spend(fam, sa, null, ps);
  select * into k from cards where not archived limit 1;
  tr := create_transfer(t.pool('USD'), (select id from wallet_accounts where card_id = k.id), 3);   -- top up first (pool -> card)
  c := create_card_spend(k.id, 2, 'test');
  x := create_expense(sa, null, 'limit test', '[{"currency":"USD","amount":-1.5}]'::jsonb);
  w1 := period_spend(fam, sa, null, ps);
  perform t.need(w1 = w0 + 2 + 1.5, 'period_spend should add 2 (card) + 1.5 (expense), got ' || (w1 - w0));
  perform delete_expense(x.id); perform delete_card_spend(c.id);
  perform t.need(period_spend(fam, sa, null, ps) = w0, 'period_spend back to start');
  reset role;
  perform t.as_user('admin'); set local role authenticated;
  perform delete_transfer(tr.id);
  reset role;
end $$;
insert into tres (test) values ('limits');

-- == Final: everything back where it started
do $$ declare s record; begin
  select * into s from start_state;
  perform t.need((select sum(balance_cache) from wallet_accounts) = s.total, 'family total unchanged');
  perform t.need((select count(*) from transactions) = s.txns, 'no leftover expenses');
  perform t.need(t.bal(t.pool('USD')) = s.pool_usd, 'pool unchanged, got ' || t.bal(t.pool('USD')) || ' expected ' || s.pool_usd);
  perform t.need(t.bal(t.acct(t.mid('member'),'USD')) = s.me_usd, 'member wallet unchanged');
  perform t.need(not exists (select 1 from wallet_accounts a where a.balance_cache <>
      (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)), 'caches still match entries');
end $$;

insert into tres (test) values ('everything back where it started');

drop schema t cascade;

select n, test, 'PASS' as result from tres union all select 999, 'ALL TESTS PASSED', 'OK' order by 1;
