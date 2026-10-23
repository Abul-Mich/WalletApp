-- 0014_down.sql: remove income. Refuses while any income record exists (delete them first, newest first,
-- with delete_income; that also takes the money back out of the wallets).
begin;
do $$ begin
  if exists (select 1 from deposits where kind <> 'deposit') then
    raise exception 'Income records exist; delete them first';
  end if;
end $$;

drop function create_income(uuid, numeric, text, numeric, uuid, text, timestamptz);
drop function delete_income(uuid);
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
  )
  select jsonb_build_object(
    'total',      coalesce((select sum(usd) from s), 0),
    'count',      (select count(*) from s),
    'daily',      coalesce((select jsonb_agg(jsonb_build_object('day', day, 'total', t) order by day)
                              from (select day, sum(usd) t from s group by day) d), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('category_id', category_id, 'kind', kind, 'total', t, 'count', n))
                              from (select category_id, kind, sum(usd) t, count(*) n from s group by category_id, kind) c), '[]'::jsonb),
    'people',     coalesce((select jsonb_agg(jsonb_build_object('member_id', owner, 'total', t))
                              from (select owner, sum(usd) t from s group by owner) p), '[]'::jsonb)
  )
$$;

revoke all on function spend_rollup(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function spend_rollup(uuid, timestamptz, timestamptz, uuid) to authenticated;

drop policy if exists deposits_select on deposits;
create policy deposits_select on deposits for select using (family_id in (select my_family_ids()));
drop index if exists deposits_family_created_ix;
alter table deposits drop column beneficiary_member_id;
alter table deposits drop column note;
alter table deposits drop column category_id;
alter table deposits drop column kind;
commit;
