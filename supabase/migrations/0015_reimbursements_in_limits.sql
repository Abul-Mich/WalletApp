-- ============================================================================
-- 0015 · Reimbursements also lower the spending LIMIT figures and category budgets.
--  0014 made spend_rollup (Home, Statistics) subtract reimbursements, but period_spend (the limit gauge in the
--  "+" sheet, the admin limits overview and category / family budgets) still ignored them.
--  period_spend now subtracts each reimbursement (in USD) from the member (the wallet owner it was paid to), from the
--  category it reimburses, and from the family total, for the same period filters. Nothing else changes.
-- Needs 0001-0014. Rollback: rollback/0015_down.sql.
-- ============================================================================
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
    union all
    select -(amount * exchange_rate_to_base) from deposits
     where family_id = p_family_id and kind = 'reimbursement'
       and (p_member_id is null or beneficiary_member_id = p_member_id)
       and (p_category_id is null or category_id = p_category_id)
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ) s;
  return v;
end $$;

commit;
