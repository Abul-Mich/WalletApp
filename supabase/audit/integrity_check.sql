-- Read-only. Run any time after cutover. Every row it returns is a problem; no rows = healthy.
--  1) a stored wallet balance that differs from the sum of its ledger entries
--  2) a negative wallet
--  3) a USD-only expense whose net_usd does not match its legs
--  4) pocket checks: every pocket has one account; pocket money only moves between a member's own wallet and own pocket; no exchanges or deposits
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
  and abs(x.net_usd + (select coalesce(sum(amount),0) from transaction_legs l where l.transaction_id = x.id)) > 0.0001
union all
select 'pocket without its account', p.id::text, p.name, 'one wallet_accounts row'
from pockets p where (select count(*) from wallet_accounts a where a.pocket_id = p.id) <> 1
union all
select 'pocket money moved outside the owner''s own wallets', t.id::text, t.amount::text, 'main wallet <-> own pocket'
from transfers t
join wallet_accounts f on f.id = t.from_account_id
join wallet_accounts o on o.id = t.to_account_id
where 'pocket' in (f.owner_kind, o.owner_kind)
  and not ((f.owner_kind = 'member' and o.owner_kind = 'pocket' and f.member_id = o.member_id)
        or (f.owner_kind = 'pocket' and o.owner_kind = 'member' and f.member_id = o.member_id))
union all
select 'pocket in an exchange or deposit', a.id::text, a.owner_kind, 'none'
from wallet_accounts a where a.owner_kind = 'pocket'
  and (exists (select 1 from wallet_entries e where e.account_id = a.id and (e.exchange_id is not null or e.deposit_id is not null)));
