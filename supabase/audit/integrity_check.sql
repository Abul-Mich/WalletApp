-- Read-only. Run any time after cutover. Every row it returns is a problem; no rows = healthy.
--  1) a stored wallet balance that differs from the sum of its ledger entries
--  2) a negative wallet
--  3) a USD-only expense whose net_usd does not match its legs
select 'balance differs from entries' as problem, a.id::text as ref, a.balance_cache::text as stored,
       (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)::text as expected
from wallet_accounts a
where a.balance_cache <> (select coalesce(sum(amount),0) from wallet_entries e where e.account_id = a.id)
union all
select 'negative wallet', id::text, balance_cache::text, '>= 0' from wallet_accounts where balance_cache < 0
union all
select 'expense value differs from legs', x.id::text, x.net_usd::text,
       (select -coalesce(sum(amount),0) from transaction_legs l where l.transaction_id = x.id)::text
from transactions x
where x.lbp_per_usd is null and x.net_usd is not null
  and abs(x.net_usd + (select coalesce(sum(amount),0) from transaction_legs l where l.transaction_id = x.id)) > 0.0001;
