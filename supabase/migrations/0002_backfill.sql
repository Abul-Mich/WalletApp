-- ============================================================================
-- 0002 · Backfill the ledger from the existing records.
--  * Reads old tables, writes only NEW tables and the new columns from 0001.
--  * Every old amount is converted to USD at the rate stored on that record
--    (original amount/currency stay on the old row for display).
--  * Ends with a reconciliation gate: ANY difference raises an error and the
--    whole transaction rolls back (nothing is changed).
--  * Run ONCE, in a quiet moment (it briefly locks a few tables). Not re-runnable
--    on success: a second run stops at the guard below.
-- Rollback: rollback/0002_down.sql
-- ============================================================================
begin;

do $$ begin
  if exists (select 1 from wallet_accounts) then
    raise exception '0002 already applied (wallet_accounts is not empty). Nothing done.';
  end if;
end $$;

-- Pause the legacy balance triggers while we only add columns/links to old rows.
alter table transactions      disable trigger trg_transactions_recalc;
alter table transactions      disable trigger trg_transactions_recalc_member_balance;
alter table transactions      disable trigger trg_transactions_check_balance;
alter table deposits          disable trigger trg_deposits_recalc;
alter table card_transactions disable trigger trg_card_transaction;

-- ---- guards: the assumptions the audit confirmed ----
do $$
declare n int;
begin
  select count(*) into n from families where base_currency <> 'USD';
  if n > 0 then raise exception 'Guard: % family(ies) with base currency other than USD', n; end if;

  select count(*) into n from (
    select card_id from (
      select card_id, currency from card_transfers
      union select card_id, currency from card_transactions) x
    group by card_id having count(distinct currency) > 1) y;
  if n > 0 then raise exception 'Guard: % card(s) used more than one currency', n; end if;

  select count(*) into n from (
    select exchange_rate_to_base from deposits union all select exchange_rate_to_base from transactions
    union all select exchange_rate_to_base from member_balance_transfers
    union all select exchange_rate_to_base from card_transfers union all select exchange_rate_to_base from card_transactions) r
  where exchange_rate_to_base is null or exchange_rate_to_base <= 0;
  if n > 0 then raise exception 'Guard: % record(s) with a missing or non-positive rate', n; end if;
end $$;

-- ---- accounts ----
insert into wallet_accounts (family_id, owner_kind, currency)
select f.id, 'pool', c from families f cross join unnest(array['USD','LBP']) c;

insert into wallet_accounts (family_id, owner_kind, member_id, currency)
select m.family_id, 'member', m.id, c from members m cross join unnest(array['USD','LBP']) c;

-- one account per card, USD (all legacy card amounts are converted to USD)
insert into wallet_accounts (family_id, owner_kind, card_id, currency)
select family_id, 'card', id, 'USD' from cards;

-- ---- deposits -> pool USD ----
update deposits d set account_id = a.id
from wallet_accounts a
where a.family_id = d.family_id and a.owner_kind = 'pool' and a.currency = 'USD';

insert into wallet_entries (account_id, amount, created_at, deposit_id)
select d.account_id, d.amount * d.exchange_rate_to_base, d.created_at, d.id from deposits d;

-- ---- balance corrections -> pool USD ----
insert into wallet_entries (account_id, amount, created_at, adjustment_id)
select a.id, w.amount, w.created_at, w.id
from wallet_balance_adjustments w
join wallet_accounts a on a.family_id = w.family_id and a.owner_kind = 'pool' and a.currency = 'USD';

-- ---- member transfers (sign = direction) -> transfers + entries ----
with src as (
  select t.id, t.family_id, t.member_id, t.created_at,
         t.amount * t.exchange_rate_to_base as usd,
         p.id as pool_id, m.id as member_acct
  from member_balance_transfers t
  join wallet_accounts p on p.family_id = t.family_id and p.owner_kind = 'pool'   and p.currency = 'USD'
  join wallet_accounts m on m.member_id = t.member_id and m.owner_kind = 'member' and m.currency = 'USD'
), ins as (
  insert into transfers (family_id, from_account_id, to_account_id, amount, created_by, legacy_table, legacy_id, created_at)
  select family_id,
         case when usd > 0 then pool_id else member_acct end,
         case when usd > 0 then member_acct else pool_id end,
         abs(usd), member_id, 'member_balance_transfers', id, created_at
  from src
  returning id, from_account_id, to_account_id, amount, created_at
)
insert into wallet_entries (account_id, amount, created_at, transfer_id)
select from_account_id, -amount, created_at, id from ins
union all
select to_account_id,    amount, created_at, id from ins;

-- ---- card top-ups: pool USD -> card ----
with src as (
  select c.id, c.family_id, c.card_id, c.member_id, c.created_at,
         c.amount * c.exchange_rate_to_base as usd,
         p.id as pool_id, ca.id as card_acct
  from card_transfers c
  join wallet_accounts p  on p.family_id = c.family_id and p.owner_kind = 'pool' and p.currency = 'USD'
  join wallet_accounts ca on ca.card_id  = c.card_id   and ca.owner_kind = 'card'
), ins as (
  insert into transfers (family_id, from_account_id, to_account_id, amount, created_by, legacy_table, legacy_id, created_at)
  select family_id, pool_id, card_acct, usd, member_id, 'card_transfers', id, created_at from src
  returning id, from_account_id, to_account_id, amount, created_at
)
insert into wallet_entries (account_id, amount, created_at, transfer_id)
select from_account_id, -amount, created_at, id from ins
union all
select to_account_id,    amount, created_at, id from ins;

-- ---- expenses: header gets net_usd, one paid leg on the member's USD wallet ----
update transactions t set
  net_usd     = t.amount * t.exchange_rate_to_base,
  lbp_per_usd = case when t.currency = 'LBP' then 1 / t.exchange_rate_to_base end;

with ins as (
  insert into transaction_legs (transaction_id, account_id, amount, created_at)
  select t.id, a.id, -t.net_usd, t.created_at
  from transactions t
  join wallet_accounts a on a.member_id = t.member_id and a.owner_kind = 'member' and a.currency = 'USD'
  returning id, account_id, amount, created_at
)
insert into wallet_entries (account_id, amount, created_at, leg_id)
select account_id, amount, created_at, id from ins;

-- ---- card spending: stays in card_transactions (source of truth), gets net_usd ----
update card_transactions c set net_usd = c.amount * c.exchange_rate_to_base;

insert into wallet_entries (account_id, amount, created_at, card_txn_id)
select a.id, -c.net_usd, c.created_at, c.id
from card_transactions c
join wallet_accounts a on a.card_id = c.card_id and a.owner_kind = 'card';

-- ---- opening correction (OD6): keep the pool the app shows today ----
-- Old rule: pool = wallet - sum(member balances) - sum(card balances), and card
-- SPENDING was never taken out of the wallet. We keep that figure and record the
-- gap as ONE visible, labelled entry (it must equal the total card spending).
do $$
declare f record; v_pool numeric; v_app numeric; v_spend numeric; v_gap numeric; v_open uuid; v_acct uuid;
begin
  for f in select id from families loop
    select a.id, a.balance_cache into v_acct, v_pool
      from wallet_accounts a where a.family_id = f.id and a.owner_kind = 'pool' and a.currency = 'USD';
    select coalesce(w.balance_cache,0)
           - (select coalesce(sum(balance),0)       from members where family_id = f.id)
           - (select coalesce(sum(balance_cache),0) from cards   where family_id = f.id)
      into v_app from (select 1) x left join wallets w on w.family_id = f.id;
    select coalesce(sum(net_usd),0) into v_spend from card_transactions where family_id = f.id;
    v_gap := v_app - v_pool;
    if abs(v_gap - v_spend) > 0.0001 then
      raise exception 'Family %: opening gap % is not the card spending % - stop and review', f.id, v_gap, v_spend;
    end if;
    if v_gap <> 0 then
      insert into opening_entries (family_id, account_id, amount, note)
      values (f.id, v_acct, v_gap,
              'Opening correction: card spending recorded before the wallet ledger was never taken from the family wallet')
      returning id into v_open;
      insert into wallet_entries (account_id, amount, opening_id) values (v_acct, v_gap, v_open);
    end if;
  end loop;
end $$;

-- re-enable legacy triggers (they stay until 0004 removes the ones that must go)
alter table transactions      enable trigger trg_transactions_recalc;
alter table transactions      enable trigger trg_transactions_recalc_member_balance;
alter table transactions      enable trigger trg_transactions_check_balance;
alter table deposits          enable trigger trg_deposits_recalc;
alter table card_transactions enable trigger trg_card_transaction;

-- ============================================================================
-- RECONCILIATION GATE — any failure raises and rolls everything back
-- ============================================================================
-- Also re-run by 0004 right before cutover: it proves nothing changed since this backfill.
create function ledger_reconcile() returns void
language plpgsql security invoker set search_path = public as $$
declare n int; r record;
begin
  -- A. balance_cache equals the sum of entries for every account
  select count(*) into n from wallet_accounts a
   where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id);
  if n > 0 then raise exception 'Gate A: % account(s) differ from their entries', n; end if;

  -- B. nothing negative
  select count(*) into n from wallet_accounts where balance_cache < 0;
  if n > 0 then raise exception 'Gate B: % account(s) are negative', n; end if;

  -- C. each member: USD wallet equals the old balance, LBP wallet is empty
  for r in select m.id, m.balance, a.balance_cache from members m
           join wallet_accounts a on a.member_id = m.id and a.currency = 'USD'
           where abs(m.balance - a.balance_cache) > 0.0001 loop
    raise exception 'Gate C: member % old % vs new %', r.id, r.balance, r.balance_cache;
  end loop;
  select count(*) into n from wallet_accounts where owner_kind in ('member','pool') and currency = 'LBP' and balance_cache <> 0;
  if n > 0 then raise exception 'Gate C: % LBP wallet(s) not empty after backfill', n; end if;

  -- D. each card: new account equals the old balance
  for r in select c.id, c.balance_cache old_b, a.balance_cache new_b from cards c
           join wallet_accounts a on a.card_id = c.id
           where abs(c.balance_cache - a.balance_cache) > 0.0001 loop
    raise exception 'Gate D: card % old % vs new %', r.id, r.old_b, r.new_b;
  end loop;

  -- E. pool equals what the app shows as unallocated today; F. family total equals old wallet
  for r in select f.id,
        coalesce(w.balance_cache,0)
          - (select coalesce(sum(balance),0) from members where family_id = f.id)
          - (select coalesce(sum(balance_cache),0) from cards where family_id = f.id) as app_pool,
        (select balance_cache from wallet_accounts where family_id = f.id and owner_kind='pool' and currency='USD') as new_pool,
        coalesce(w.balance_cache,0) as old_total,
        (select coalesce(sum(balance_cache),0) from wallet_accounts where family_id = f.id and currency='USD') as new_total
      from families f left join wallets w on w.family_id = f.id loop
    if abs(r.app_pool - r.new_pool) > 0.0001 then raise exception 'Gate E: family % pool old % vs new %', r.id, r.app_pool, r.new_pool; end if;
    if abs(r.old_total - r.new_total) > 0.0001 then raise exception 'Gate F: family % total old % vs new %', r.id, r.old_total, r.new_total; end if;
  end loop;

  -- G. every expense has exactly one leg and a net value; every card spend has one entry
  select count(*) into n from transactions t
   where t.net_usd is null or (select count(*) from transaction_legs l where l.transaction_id = t.id) <> 1
      or abs(t.net_usd + (select sum(amount) from transaction_legs l where l.transaction_id = t.id)) > 0.0001;
  if n > 0 then raise exception 'Gate G: % expense(s) without a matching leg/net value', n; end if;
  select count(*) into n from card_transactions c
   where c.net_usd is null or (select count(*) from wallet_entries e where e.card_txn_id = c.id) <> 1;
  if n > 0 then raise exception 'Gate G: % card spending row(s) without an entry', n; end if;

  -- H. record counts carried over
  select count(*) into n from (
    select (select count(*) from deposits)                 as a, (select count(*) from wallet_entries where deposit_id is not null) as b
    union all select (select count(*) from wallet_balance_adjustments), (select count(*) from wallet_entries where adjustment_id is not null)
    union all select (select count(*) from member_balance_transfers) + (select count(*) from card_transfers), (select count(*) from transfers)
  ) q where a <> b;
  if n > 0 then raise exception 'Gate H: % record count(s) differ', n; end if;
end $$;

select ledger_reconcile();

commit;

-- What you should see: RECONCILED plus the same four figures the app shows today.
select 'RECONCILED' as result,
       (select coalesce(sum(balance_cache),0) from wallet_accounts where currency='USD')                             as family_total_usd,
       (select coalesce(sum(balance_cache),0) from wallet_accounts where owner_kind='pool'   and currency='USD')     as pool_usd,
       (select coalesce(sum(balance_cache),0) from wallet_accounts where owner_kind='member' and currency='USD')     as members_usd,
       (select coalesce(sum(balance_cache),0) from wallet_accounts where owner_kind='card')                          as cards_usd,
       (select coalesce(sum(amount),0) from opening_entries)                                                         as opening_correction_usd;
