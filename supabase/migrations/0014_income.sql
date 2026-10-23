-- ============================================================================
-- 0014 · Money from outside (income): salary, bonus, gift, reimbursement, other.
--  * Outside money is recorded in the existing `deposits` table, which gets four new columns:
--    kind, category_id (reimbursements), note, beneficiary_member_id (the wallet or pocket owner).
--    Existing rows keep kind 'deposit' (family funding by an admin) and change in no other way.
--  * create_income: a member adds to their own main wallet or own pockets; admins also add to the family pool and to cards.
--    delete_income: the person who added it or an admin removes it (fails if the money is already spent).
--  * Statistics: salary, bonus, gift, other and legacy deposits are "money in". A reimbursement is NOT income: it lowers its
--    category's spending, and so lowers the spending total and the limit figure, by the same amount.
--  * spend_rollup gains an `income` total and subtracts reimbursements. Spending limits (period_spend) are unchanged by this migration.
--  * Pocket privacy: a deposit into a pocket is visible only to the pocket's owner and admins (same rule as the pocket itself).
-- Needs 0001-0013. Rollback: rollback/0014_down.sql.
-- ============================================================================
begin;

alter table deposits add column kind text not null default 'deposit'
  check (kind in ('deposit','salary','bonus','gift','reimbursement','other'));
alter table deposits add column category_id uuid references categories(id) on delete set null;
alter table deposits add column note text check (note is null or char_length(note) <= 200);
alter table deposits add column beneficiary_member_id uuid references members(id) on delete set null;
create index deposits_family_created_ix on deposits (family_id, created_at);

-- a deposit is visible when the account it went into is visible
drop policy if exists deposits_select on deposits;
create policy deposits_select on deposits for select using (
  family_id in (select my_family_ids())
  and (account_id is null or exists (select 1 from wallet_accounts a where a.id = deposits.account_id))
);

-- -------------------------------------------------------------- functions --
create function create_income(p_account_id uuid, p_amount numeric, p_kind text,
                              p_lbp_per_usd numeric default null, p_category_id uuid default null,
                              p_note text default null, p_created_at timestamptz default null) returns deposits
language plpgsql security definer set search_path = public as $$
declare a wallet_accounts; c members; d deposits; v_when timestamptz := coalesce(p_created_at, now()); v_rate numeric;
        v_cat uuid := null; v_benef uuid := null;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if p_kind is null or p_kind not in ('salary','bonus','gift','reimbursement','other') then
    raise exception 'Choose what kind of money this is'; end if;
  select * into a from wallet_accounts where id = p_account_id;
  if not found then raise exception 'Wallet not found'; end if;
  c := _caller(a.family_id);
  if p_amount < 0.01 then raise exception 'Amount is too small'; end if;
  if v_when > now() + interval '1 minute' then raise exception 'The date cannot be in the future'; end if;

  if a.owner_kind in ('pool','card') then
    if not _is_admin(c) then raise exception 'Only admins can add money to the family pool or a card' using errcode = '42501'; end if;
  else
    if a.member_id <> c.id then raise exception 'You can only add money to your own wallet or pockets' using errcode = '42501'; end if;
    v_benef := a.member_id;
    if a.owner_kind = 'pocket' and (select archived from pockets where id = a.pocket_id) then
      raise exception 'This pocket is archived'; end if;
  end if;

  if p_kind = 'reimbursement' then
    if p_category_id is null or not exists (select 1 from categories where id = p_category_id and family_id = a.family_id) then
      raise exception 'Choose the category this reimburses'; end if;
    v_cat := p_category_id;
  end if;

  if a.currency = 'USD' then v_rate := 1;
  else
    perform _check_rate(a.family_id, p_lbp_per_usd, _is_admin(c));
    v_rate := 1 / p_lbp_per_usd;
  end if;

  perform _lock_accounts(array[a.id]);
  insert into deposits (family_id, added_by_member_id, amount, currency, exchange_rate_to_base, account_id, created_at,
                        kind, category_id, note, beneficiary_member_id)
  values (a.family_id, c.id, p_amount, a.currency, v_rate, a.id, v_when,
          p_kind, v_cat, nullif(btrim(p_note), ''), v_benef) returning * into d;
  insert into wallet_entries (account_id, amount, created_at, deposit_id) values (a.id, p_amount, v_when, d.id);
  perform _settle();
  return d;
end $$;

create function delete_income(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d deposits; c members;
begin
  select * into d from deposits where id = p_id for update;
  if not found then raise exception 'Record not found'; end if;
  c := _caller(d.family_id);
  if d.kind = 'deposit' then raise exception 'Use the pool deposit tools for this record' using errcode = '42501'; end if;
  if not (_is_admin(c) or d.added_by_member_id = c.id) then
    raise exception 'Only the person who added this, or an admin, can delete it' using errcode = '42501'; end if;
  perform _lock_accounts(array[d.account_id]);
  delete from deposits where id = p_id;                               -- the ledger entry cascades; the non-negative rule is judged at commit
  perform _settle();
end $$;

-- ----------------------------------------------------------- statistics --
drop function spend_rollup(uuid, timestamptz, timestamptz, uuid);
create function spend_rollup(p_family_id uuid, p_from timestamptz default null, p_to timestamptz default null,
                             p_member_id uuid default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with s as (
    select (created_at at time zone 'Asia/Beirut')::date as day, category_id, 'transaction'::text as kind,
           member_id as owner, coalesce(net_usd, amount * exchange_rate_to_base) as usd
      from transactions
     where family_id = p_family_id
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
       and (p_member_id is null or member_id = p_member_id)
    union all
    select (created_at at time zone 'Asia/Beirut')::date, category_id, 'card',
           coalesce(tagged_member_id, member_id), coalesce(net_usd, amount * exchange_rate_to_base)
      from card_transactions
     where family_id = p_family_id
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
       and (p_member_id is null or coalesce(tagged_member_id, member_id) = p_member_id)
    union all
    select (created_at at time zone 'Asia/Beirut')::date, category_id, 'common',
           tagged_member_id, net_usd
      from common_expenses
     where family_id = p_family_id
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
       and (p_member_id is null or tagged_member_id = p_member_id)
    union all
    -- a reimbursement is negative spending in the category it reimburses
    select (created_at at time zone 'Asia/Beirut')::date, category_id, 'reimbursement',
           beneficiary_member_id, -(amount * exchange_rate_to_base)
      from deposits
     where family_id = p_family_id and kind = 'reimbursement'
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
       and (p_member_id is null or beneficiary_member_id = p_member_id)
  ),
  i as (
    select (amount * exchange_rate_to_base) as usd
      from deposits
     where family_id = p_family_id and kind <> 'reimbursement'
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
       and (p_member_id is null or beneficiary_member_id = p_member_id)
  )
  select jsonb_build_object(
    'total',      coalesce((select sum(usd) from s), 0),
    'count',      (select count(*) from s where kind <> 'reimbursement'),
    'income',     coalesce((select sum(usd) from i), 0),
    'daily',      coalesce((select jsonb_agg(jsonb_build_object('day', day, 'total', t) order by day)
                              from (select day, sum(usd) t from s group by day) d), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('category_id', category_id, 'kind', kind, 'total', t, 'count', n))
                              from (select category_id, kind, sum(usd) t, count(*) n from s group by category_id, kind) c), '[]'::jsonb),
    'people',     coalesce((select jsonb_agg(jsonb_build_object('member_id', owner, 'total', t))
                              from (select owner, sum(usd) t from s group by owner) p), '[]'::jsonb)
  )
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_income','delete_income','spend_rollup')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

commit;
