-- ============================================================================
-- 0018 · Edit money-in records and family bills
--  * update_income:      amount, kind, category (reimbursement), who it counts for (pool/card), exchange rate, date, note.
--                        The wallet it went into cannot change (delete and re-add to move it).
--  * update_common_bill: name, usual amount, currency, repeat, next due date, category, tagged person (admins).
--  * Who may edit money-in: the person who added it, or any admin. Pool/card money: admins only.
--  * An edit rewrites the record AND its ledger entry in one step, so balances, limits and statistics follow.
--    Nothing is saved if the new amount would take a wallet below zero.
-- Needs 0006, 0014, 0017. Rollback: rollback/0018_down.sql (drops the two functions only).
-- ============================================================================
begin;

create function update_income(p_id uuid, p_amount numeric, p_kind text,
                              p_lbp_per_usd numeric default null, p_category_id uuid default null,
                              p_note text default null, p_created_at timestamptz default null,
                              p_beneficiary_member_id uuid default null) returns deposits
language plpgsql security definer set search_path = public as $$
declare d deposits; a wallet_accounts; c members; v_when timestamptz; v_rate numeric; v_old_lbp numeric;
        v_cat uuid := null; v_benef uuid;
begin
  select * into d from deposits where id = p_id for update;
  if not found then raise exception 'Record not found'; end if;
  c := _caller(d.family_id);
  if d.kind = 'deposit' then raise exception 'Use the pool deposit tools for this record' using errcode = '42501'; end if;
  select * into a from wallet_accounts where id = d.account_id;
  if not (_is_admin(c) or d.added_by_member_id = c.id) then
    raise exception 'Only the person who added this, or an admin, can edit it' using errcode = '42501'; end if;
  if a.owner_kind in ('pool','card') and not _is_admin(c) then
    raise exception 'Only admins can edit money added to the family pool or a card' using errcode = '42501'; end if;
  if a.owner_kind = 'pocket' and (select archived from pockets where id = a.pocket_id) then
    raise exception 'This pocket is archived'; end if;
  if p_amount is null or p_amount < 0.01 then raise exception 'Amount must be at least 0.01'; end if;
  if p_kind is null or p_kind not in ('salary','bonus','gift','reimbursement','other') then
    raise exception 'Choose what kind of money this is'; end if;

  v_when := coalesce(p_created_at, d.created_at);
  if v_when is distinct from d.created_at and v_when > now() + interval '1 minute' then
    raise exception 'The date cannot be in the future'; end if;

  if p_kind = 'reimbursement' then
    if p_category_id is null or not exists (select 1 from categories where id = p_category_id and family_id = d.family_id) then
      raise exception 'Choose the category this reimburses'; end if;
    v_cat := p_category_id;
  end if;

  if a.owner_kind in ('pool','card') then
    if p_beneficiary_member_id is not null
       and p_beneficiary_member_id is distinct from d.beneficiary_member_id
       and not exists (select 1 from members where id = p_beneficiary_member_id and family_id = d.family_id and removed_at is null) then
      raise exception 'That person is not part of this family'; end if;
    v_benef := p_beneficiary_member_id;
  else
    v_benef := a.member_id;                       -- own wallet / pockets always count for the owner
  end if;

  if a.currency = 'USD' then v_rate := 1;
  else
    v_old_lbp := case when d.exchange_rate_to_base > 0 then 1 / d.exchange_rate_to_base end;
    if coalesce(p_lbp_per_usd, v_old_lbp) is null then raise exception 'Enter the exchange rate'; end if;
    -- only re-check a rate that was actually changed
    if v_old_lbp is null or abs(coalesce(p_lbp_per_usd, v_old_lbp) - v_old_lbp) > 0.5 then
      perform _check_rate(d.family_id, p_lbp_per_usd, _is_admin(c)); end if;
    v_rate := 1 / coalesce(p_lbp_per_usd, v_old_lbp);
  end if;

  perform _lock_accounts(array[a.id]);
  update deposits set amount = p_amount, exchange_rate_to_base = v_rate, kind = p_kind, category_id = v_cat,
         note = nullif(btrim(p_note), ''), created_at = v_when, beneficiary_member_id = v_benef
   where id = d.id returning * into d;
  update wallet_entries set amount = p_amount, created_at = v_when where deposit_id = d.id;
  perform _settle();                              -- the non-negative rule is judged here / at commit
  return d;
end $$;

create function update_common_bill(p_id uuid, p_name text, p_amount numeric, p_currency text, p_recurrence text,
                                   p_next_due date, p_category_id uuid default null, p_tagged_member_id uuid default null)
returns common_bills
language plpgsql security definer set search_path = public as $$
declare b common_bills; c members;
begin
  select * into b from common_bills where id = p_id for update;
  if not found then raise exception 'Bill not found'; end if;
  c := _caller(b.family_id);
  if not _is_admin(c) then raise exception 'Only admins can edit common bills' using errcode = '42501'; end if;
  if nullif(btrim(p_name),'') is null then raise exception 'A bill needs a name'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if p_currency not in ('USD','LBP') then raise exception 'Bills are in USD or LBP'; end if;
  if p_recurrence not in ('monthly','weekly','one_time') then raise exception 'Repeat must be monthly, weekly or one time'; end if;
  if p_next_due is null then raise exception 'A bill needs a due date'; end if;
  if p_category_id is not null and not exists (select 1 from categories where id = p_category_id and family_id = b.family_id) then
    raise exception 'Category not found'; end if;
  if p_tagged_member_id is not null and p_tagged_member_id is distinct from b.tagged_member_id
     and not exists (select 1 from members where id = p_tagged_member_id and family_id = b.family_id and removed_at is null) then
    raise exception 'The tagged member is not part of this family'; end if;
  update common_bills set name = btrim(p_name), amount = p_amount, currency = p_currency, recurrence = p_recurrence,
         next_due_date = p_next_due, category_id = p_category_id, tagged_member_id = p_tagged_member_id
   where id = b.id returning * into b;
  return b;
end $$;

revoke all on function update_income(uuid, numeric, text, numeric, uuid, text, timestamptz, uuid) from public, anon;
grant execute on function update_income(uuid, numeric, text, numeric, uuid, text, timestamptz, uuid) to authenticated;
revoke all on function update_common_bill(uuid, text, numeric, text, text, date, uuid, uuid) from public, anon;
grant execute on function update_common_bill(uuid, text, numeric, text, text, date, uuid, uuid) to authenticated;

commit;
