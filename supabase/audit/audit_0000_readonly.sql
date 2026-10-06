-- ============================================================================
-- Family Wallet: audit 0000 (READ-ONLY)
-- ----------------------------------------------------------------------------
-- Purpose : describe the live data BEFORE the two-wallet migration, and prove
--           that the balances stored today match what the records add up to.
-- Safety  : this file is ONE SELECT statement. It contains no INSERT, UPDATE,
--           DELETE, DDL or function calls that write. It changes nothing.
-- How to run: Supabase dashboard > SQL Editor > paste this whole file > Run.
--           The result is a single table. Copy it (or export CSV) and save it
--           as "audit_before_<date>.csv" - it is the "before" snapshot.
-- Output  : sec  = section, chk = what was checked, val = result,
--           flag = OK (as expected), INFO (just a fact), REVIEW (look at it).
-- Notes   : all money below is in the family's BASE currency
--           (amount * exchange_rate_to_base), exactly how the app computes it.
--           Member names are not printed; members are numbered.
-- ============================================================================
with
-- ---- per-family sums, all in base currency --------------------------------
dep as (select family_id, sum(amount * exchange_rate_to_base) v from deposits group by 1),
tx  as (select family_id, sum(amount * exchange_rate_to_base) v from transactions group by 1),
adj as (select family_id, sum(amount) v from wallet_balance_adjustments group by 1),
mtr as (select family_id, sum(amount * exchange_rate_to_base) v from member_balance_transfers group by 1),
ctp as (select family_id, sum(amount * exchange_rate_to_base) v from card_transfers group by 1),
cwd as (select family_id, sum(amount * exchange_rate_to_base) v from card_transactions group by 1),
mbal as (select family_id, sum(balance) v from members group by 1),
cbal as (select family_id, sum(balance_cache) v from cards group by 1),
fam as (
  select f.id, f.base_currency,
         coalesce(dep.v, 0)  as d,
         coalesce(tx.v, 0)   as t,
         coalesce(adj.v, 0)  as a,
         coalesce(mtr.v, 0)  as tr,
         coalesce(ctp.v, 0)  as ct,
         coalesce(cwd.v, 0)  as w,
         coalesce(mbal.v, 0) as mb,
         coalesce(cbal.v, 0) as cb,
         w0.balance_cache    as wallet_cache,
         row_number() over (order by f.created_at) as fnum
  from families f
  left join dep  on dep.family_id  = f.id
  left join tx   on tx.family_id   = f.id
  left join adj  on adj.family_id  = f.id
  left join mtr  on mtr.family_id  = f.id
  left join ctp  on ctp.family_id  = f.id
  left join cwd  on cwd.family_id  = f.id
  left join mbal on mbal.family_id = f.id
  left join cbal on cbal.family_id = f.id
  left join wallets w0 on w0.family_id = f.id
),
-- ---- per-member and per-card recomputation ---------------------------------
mrec as (
  select m.id, m.family_id, m.role, m.balance,
         coalesce((select sum(x.amount * x.exchange_rate_to_base) from member_balance_transfers x where x.member_id = m.id), 0)
       - coalesce((select sum(x.amount * x.exchange_rate_to_base) from transactions x where x.member_id = m.id), 0) as rec,
         row_number() over (order by m.created_at) as mnum
  from members m
),
crec as (
  select c.id, c.family_id, c.balance_cache, c.archived,
         coalesce((select sum(x.amount * x.exchange_rate_to_base) from card_transfers x where x.card_id = c.id), 0)
       - coalesce((select sum(x.amount * x.exchange_rate_to_base) from card_transactions x where x.card_id = c.id), 0) as rec,
         row_number() over (order by c.created_at) as cnum
  from cards c
),
-- ---- every money row with its currency and rate, for currency/rate checks --
allrows as (
  select 'deposits' as tbl, currency, amount, exchange_rate_to_base as rate from deposits
  union all select 'transactions', currency, amount, exchange_rate_to_base from transactions
  union all select 'member_balance_transfers', currency, amount, exchange_rate_to_base from member_balance_transfers
  union all select 'card_transfers', currency, amount, exchange_rate_to_base from card_transfers
  union all select 'card_transactions', currency, amount, exchange_rate_to_base from card_transactions
  union all select 'planned_payments', currency, amount, exchange_rate_to_base from planned_payments
),
-- ---- currencies used per card ---------------------------------------------
cardcur as (
  select card_id, currency from card_transfers
  union select card_id, currency from card_transactions
),
cardcur_n as (
  select c.id, count(distinct cc.currency) as n
  from cards c left join cardcur cc on cc.card_id = c.id
  group by c.id
),
-- ---- possible duplicate expenses (same member, amount, currency, note, minute)
dups as (
  select member_id, amount, currency, coalesce(note, '') as note,
         date_trunc('minute', created_at) as minute, count(*) as n
  from transactions
  group by 1, 2, 3, 4, 5
  having count(*) > 1
),
result(ord, sec, chk, val, flag) as (

  -- 01 ROW COUNTS ------------------------------------------------------------
            select 0101, '01 row counts', 'families',                   (select count(*) from families)::text, 'INFO'
  union all select 0102, '01 row counts', 'members',                    (select count(*) from members)::text, 'INFO'
  union all select 0103, '01 row counts', 'wallets (one per family)',   (select count(*) from wallets)::text, 'INFO'
  union all select 0104, '01 row counts', 'wallet_balance_adjustments', (select count(*) from wallet_balance_adjustments)::text, 'INFO'
  union all select 0105, '01 row counts', 'categories',                 (select count(*) from categories)::text, 'INFO'
  union all select 0106, '01 row counts', 'deposits',                   (select count(*) from deposits)::text, 'INFO'
  union all select 0107, '01 row counts', 'transactions (expenses)',    (select count(*) from transactions)::text, 'INFO'
  union all select 0108, '01 row counts', 'exchange_rate_overrides',    (select count(*) from exchange_rate_overrides)::text, 'INFO'
  union all select 0109, '01 row counts', 'family_invites',             (select count(*) from family_invites)::text, 'INFO'
  union all select 0110, '01 row counts', 'planned_payments',           (select count(*) from planned_payments)::text, 'INFO'
  union all select 0111, '01 row counts', 'member_balance_transfers',   (select count(*) from member_balance_transfers)::text, 'INFO'
  union all select 0112, '01 row counts', 'notifications',              (select count(*) from notifications)::text, 'INFO'
  union all select 0113, '01 row counts', 'cards',                      (select count(*) from cards)::text, 'INFO'
  union all select 0114, '01 row counts', 'card_transfers (top-ups)',   (select count(*) from card_transfers)::text, 'INFO'
  union all select 0115, '01 row counts', 'card_transactions (card spending)', (select count(*) from card_transactions)::text, 'INFO'

  -- 02 FAMILY AND ROLES ------------------------------------------------------
  union all select 0201, '02 family', 'number of families (expected 1)',
                    (select count(*) from families)::text,
                    case when (select count(*) from families) = 1 then 'OK' else 'REVIEW' end
  union all select 0202 + fnum::int, '02 family', 'base currency of family ' || fnum || ' (migration assumes USD)',
                    base_currency, case when base_currency = 'USD' then 'OK' else 'REVIEW' end
            from fam
  union all select 0210, '02 family', 'superadmins (expected 1 per family)',
                    (select count(*) from members where role = 'superadmin')::text,
                    case when (select count(*) from members where role = 'superadmin') = (select count(*) from families) then 'OK' else 'REVIEW' end
  union all select 0211, '02 family', 'admins',  (select count(*) from members where role = 'admin')::text, 'INFO'
  union all select 0212, '02 family', 'members', (select count(*) from members where role = 'member')::text, 'INFO'
  union all select 0213, '02 family', 'families without a wallets row',
                    (select count(*) from families f where not exists (select 1 from wallets w where w.family_id = f.id))::text,
                    case when (select count(*) from families f where not exists (select 1 from wallets w where w.family_id = f.id)) = 0 then 'OK' else 'REVIEW' end

  -- 03 CURRENCIES USED --------------------------------------------------------
  union all select 0300 + (row_number() over (order by tbl, currency))::int, '03 currencies',
                    tbl || ' / ' || currency || ' (rows, total original amount)',
                    count(*)::text || ' rows, ' || round(sum(amount), 4)::text,
                    case when currency in ('USD', 'LBP', 'EUR', 'GBP') then 'INFO' else 'REVIEW' end
            from allrows group by tbl, currency

  -- 04 RATES -------------------------------------------------------------------
  union all select 0401, '04 rates', 'rows with a rate that is null or <= 0',
                    (select count(*) from allrows where rate is null or rate <= 0)::text,
                    case when (select count(*) from allrows where rate is null or rate <= 0) = 0 then 'OK' else 'REVIEW' end
  union all select 0410 + (row_number() over (order by currency))::int, '04 rates',
                    'rate to base for ' || currency || ' (min / max / distinct values)',
                    min(rate)::text || ' / ' || max(rate)::text || ' / ' || count(distinct rate)::text,
                    case when currency = 'USD' and (min(rate) <> 1 or max(rate) <> 1) then 'REVIEW' else 'INFO' end
            from allrows where rate is not null group by currency
  union all select 0450, '04 rates', 'USD rows whose rate is not exactly 1 (base is USD)',
                    (select count(*) from allrows where currency = 'USD' and rate <> 1)::text,
                    case when (select count(*) from allrows where currency = 'USD' and rate <> 1) = 0 then 'OK' else 'REVIEW' end

  -- 05 PRECISION ---------------------------------------------------------------
  union all select 0501, '05 precision', 'non-LBP rows with more than 2 decimals in the amount',
                    (select count(*) from allrows where currency <> 'LBP' and amount <> round(amount, 2))::text,
                    case when (select count(*) from allrows where currency <> 'LBP' and amount <> round(amount, 2)) = 0 then 'OK' else 'REVIEW' end
  union all select 0502, '05 precision', 'LBP rows with decimals in the amount',
                    (select count(*) from allrows where currency = 'LBP' and amount <> round(amount, 0))::text,
                    case when (select count(*) from allrows where currency = 'LBP' and amount <> round(amount, 0)) = 0 then 'OK' else 'REVIEW' end

  -- 06 FAMILY BALANCE (stored vs recomputed) ----------------------------------
  union all select 0600 + fnum::int * 10 + 1, '06 family balance', 'family ' || fnum || ': stored wallets.balance_cache',
                    coalesce(round(wallet_cache, 4)::text, 'MISSING'), 'INFO' from fam
  union all select 0600 + fnum::int * 10 + 2, '06 family balance', 'family ' || fnum || ': recomputed = deposits - expenses + adjustments',
                    round(d - t + a, 4)::text, 'INFO' from fam
  union all select 0600 + fnum::int * 10 + 3, '06 family balance', 'family ' || fnum || ': difference stored minus recomputed (expected 0)',
                    coalesce(round(wallet_cache - (d - t + a), 4)::text, 'MISSING'),
                    case when wallet_cache is not null and abs(wallet_cache - (d - t + a)) < 0.005 then 'OK' else 'REVIEW' end from fam

  -- 07 MEMBER BALANCES (stored vs recomputed) ---------------------------------
  union all select 0701, '07 member balances', 'members whose stored balance differs from transfers minus expenses (expected 0)',
                    (select count(*) from mrec where abs(balance - rec) >= 0.005)::text,
                    case when (select count(*) from mrec where abs(balance - rec) >= 0.005) = 0 then 'OK' else 'REVIEW' end
  union all select 0702, '07 member balances', 'largest difference',
                    coalesce((select max(abs(balance - rec)) from mrec), 0)::text, 'INFO'
  union all select 0703, '07 member balances', 'members with a negative balance (expected 0)',
                    (select count(*) from mrec where balance < 0)::text,
                    case when (select count(*) from mrec where balance < 0) = 0 then 'OK' else 'REVIEW' end
  union all select 0710 + mnum::int, '07 member balances',
                    'member ' || mnum || ' (' || role || '): stored / recomputed',
                    round(balance, 4)::text || ' / ' || round(rec, 4)::text,
                    case when abs(balance - rec) < 0.005 then 'OK' else 'REVIEW' end
            from mrec

  -- 08 CARD BALANCES (stored vs recomputed) -----------------------------------
  union all select 0801, '08 card balances', 'cards whose stored balance differs from top-ups minus spending (expected 0)',
                    (select count(*) from crec where abs(balance_cache - rec) >= 0.005)::text,
                    case when (select count(*) from crec where abs(balance_cache - rec) >= 0.005) = 0 then 'OK' else 'REVIEW' end
  union all select 0802, '08 card balances', 'cards with a negative balance (expected 0)',
                    (select count(*) from crec where balance_cache < 0)::text,
                    case when (select count(*) from crec where balance_cache < 0) = 0 then 'OK' else 'REVIEW' end
  union all select 0810 + cnum::int, '08 card balances',
                    'card ' || cnum || case when archived then ' (archived)' else '' end || ': stored / recomputed',
                    round(balance_cache, 4)::text || ' / ' || round(rec, 4)::text,
                    case when abs(balance_cache - rec) < 0.005 then 'OK' else 'REVIEW' end
            from crec

  -- 09 CARDS: ONE CURRENCY EACH ------------------------------------------------
  union all select 0901, '09 card currency', 'cards that used more than one currency (expected 0)',
                    (select count(*) from cardcur_n where n > 1)::text,
                    case when (select count(*) from cardcur_n where n > 1) = 0 then 'OK' else 'REVIEW' end
  union all select 0902, '09 card currency', 'cards with no activity at all',
                    (select count(*) from cardcur_n where n = 0)::text, 'INFO'
  union all select 0910 + (row_number() over (order by currency))::int, '09 card currency',
                    'cards using ' || currency || ' (rows across top-ups and spending)',
                    count(distinct card_id)::text || ' cards', 'INFO'
            from cardcur group by currency

  -- 10 POOL ("unallocated") AND THE CARD-SPENDING EFFECT -----------------------
  -- The app shows unallocated = wallet - member balances - card balances.
  -- Card spending never reduces the wallet, so each spent card amount makes
  -- that figure larger. The corrected pool below does not have that effect.
  union all select 1000 + fnum::int * 10 + 1, '10 pool', 'family ' || fnum || ': unallocated as the app computes it today',
                    round(coalesce(wallet_cache, 0) - mb - cb, 4)::text, 'INFO' from fam
  union all select 1000 + fnum::int * 10 + 2, '10 pool', 'family ' || fnum || ': corrected pool = deposits + adjustments - member transfers - card top-ups',
                    round(d + a - tr - ct, 4)::text, 'INFO' from fam
  union all select 1000 + fnum::int * 10 + 3, '10 pool', 'family ' || fnum || ': total card spending ever (this is the overstatement)',
                    round(w, 4)::text, case when w = 0 then 'OK' else 'REVIEW' end from fam
  union all select 1000 + fnum::int * 10 + 4, '10 pool', 'family ' || fnum || ': today minus corrected (should equal card spending)',
                    round((coalesce(wallet_cache, 0) - mb - cb) - (d + a - tr - ct), 4)::text,
                    case when abs((coalesce(wallet_cache, 0) - mb - cb) - (d + a - tr - ct) - w) < 0.005 then 'OK' else 'REVIEW' end from fam
  union all select 1000 + fnum::int * 10 + 5, '10 pool', 'family ' || fnum || ': money in members, in cards, and corrected pool (sum = family total after spending)',
                    round(mb, 4)::text || ' / ' || round(cb, 4)::text || ' / ' || round(d + a - tr - ct, 4)::text, 'INFO' from fam

  -- 11 INTEGRITY ---------------------------------------------------------------
  union all select 1101, '11 integrity', 'expenses with no category',
                    (select count(*) from transactions where category_id is null)::text, 'INFO'
  union all select 1102, '11 integrity', 'expenses whose member belongs to another family',
                    (select count(*) from transactions t join members m on m.id = t.member_id where m.family_id <> t.family_id)::text,
                    case when (select count(*) from transactions t join members m on m.id = t.member_id where m.family_id <> t.family_id) = 0 then 'OK' else 'REVIEW' end
  union all select 1103, '11 integrity', 'expenses whose category belongs to another family',
                    (select count(*) from transactions t join categories c on c.id = t.category_id where c.family_id <> t.family_id)::text,
                    case when (select count(*) from transactions t join categories c on c.id = t.category_id where c.family_id <> t.family_id) = 0 then 'OK' else 'REVIEW' end
  union all select 1104, '11 integrity', 'card rows whose card belongs to another family',
                    ((select count(*) from card_transfers x join cards c on c.id = x.card_id where c.family_id <> x.family_id)
                   + (select count(*) from card_transactions x join cards c on c.id = x.card_id where c.family_id <> x.family_id))::text,
                    case when ((select count(*) from card_transfers x join cards c on c.id = x.card_id where c.family_id <> x.family_id)
                             + (select count(*) from card_transactions x join cards c on c.id = x.card_id where c.family_id <> x.family_id)) = 0 then 'OK' else 'REVIEW' end
  union all select 1105, '11 integrity', 'amounts that are zero or negative (should be impossible)',
                    (select count(*) from allrows where amount <= 0)::text,
                    case when (select count(*) from allrows where amount <= 0) = 0 then 'OK' else 'REVIEW' end
  union all select 1106, '11 integrity', 'possible duplicate expenses (same member, amount, currency, note, minute)',
                    (select count(*) from dups)::text,
                    case when (select count(*) from dups) = 0 then 'OK' else 'REVIEW' end
  union all select 1107, '11 integrity', 'wallet adjustments (balance corrections) on record',
                    (select count(*) from wallet_balance_adjustments)::text, 'INFO'

  -- 12 DATES -------------------------------------------------------------------
  union all select 1201, '12 dates', 'first and last expense',
                    coalesce(min(created_at)::text, 'none') || ' / ' || coalesce(max(created_at)::text, 'none'), 'INFO' from transactions
  union all select 1202, '12 dates', 'first and last deposit',
                    coalesce(min(created_at)::text, 'none') || ' / ' || coalesce(max(created_at)::text, 'none'), 'INFO' from deposits
  union all select 1203, '12 dates', 'rows dated in the future',
                    ((select count(*) from transactions where created_at > now())
                   + (select count(*) from deposits where created_at > now())
                   + (select count(*) from member_balance_transfers where created_at > now()))::text,
                    case when ((select count(*) from transactions where created_at > now())
                             + (select count(*) from deposits where created_at > now())
                             + (select count(*) from member_balance_transfers where created_at > now())) = 0 then 'OK' else 'REVIEW' end

  -- 13 SECURITY FACTS (what the design is meant to fix) ----------------------
  union all select 1301, '13 security facts', 'invites still unused and unexpired',
                    (select count(*) from family_invites where used_at is null and expires_at > now())::text, 'INFO'
  union all select 1302, '13 security facts', 'members with a personal spending limit set',
                    (select count(*) from members where spending_limit_amount is not null)::text, 'INFO'
)
select sec, chk, val, flag
from result
order by ord;
