-- Rollback of 0015: period_spend goes back to ignoring reimbursements (the 0010 version).
begin;
create or replace function period_spend(p_family_id uuid, p_member_id uuid default null, p_category_id uuid default null,
                             p_from timestamptz default null, p_to timestamptz default null) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  perform _caller(p_family_id);
  select coalesce(sum(net_usd),0) into v from (
    select net_usd from transactions
     where family_id = p_family_id and (p_member_id is null or member_id = p_member_id)
       and (p_category_id is null or category_id = p_category_id)
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
    union all
    select net_usd from card_transactions
     where family_id = p_family_id and (p_member_id is null or coalesce(tagged_member_id, member_id) = p_member_id)
       and (p_category_id is null or category_id = p_category_id)
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
    union all
    select net_usd from common_expenses
     where p_member_id is null and family_id = p_family_id
       and (p_category_id is null or category_id = p_category_id)
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ) s;
  return v;
end $$;
commit;
