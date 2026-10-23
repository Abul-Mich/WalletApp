-- Rollback of 0017: create_income goes back to the 0014 version (no "who it counts for" argument).
begin;
drop function create_income(uuid, numeric, text, numeric, uuid, text, timestamptz, uuid);

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

revoke all on function create_income(uuid, numeric, text, numeric, uuid, text, timestamptz) from public, anon;
grant execute on function create_income(uuid, numeric, text, numeric, uuid, text, timestamptz) to authenticated;
commit;
