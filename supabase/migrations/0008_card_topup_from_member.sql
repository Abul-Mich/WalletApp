-- ============================================================================
-- 0008 · Top up a prepaid card from a member's own wallet (not only from the pool)
--  * A member can move money from THEIR OWN wallet onto a card (same currency).
--    Pool -> card is unchanged; admins could already move any wallet to any card.
--  * Everything else stays as it was: a member still cannot take money out of a card,
--    and cannot touch another member's wallet.
--  * Same function signature as 0005, so this is a plain replace. Needs 0005.
-- Rollback: rollback/0008_down.sql
-- ============================================================================
begin;

create or replace function create_transfer(p_from uuid, p_to uuid, p_amount numeric, p_note text default null,
                                p_created_at timestamptz default null,
                                p_tagged_member_id uuid default null) returns transfers
language plpgsql security definer set search_path = public as $$
declare f wallet_accounts; t wallet_accounts; c members; r transfers; v_when timestamptz := coalesce(p_created_at, now()); ok boolean;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  if p_from = p_to then raise exception 'Choose two different wallets'; end if;
  select * into f from wallet_accounts where id = p_from;
  select * into t from wallet_accounts where id = p_to;
  if f.id is null or t.id is null then raise exception 'Wallet not found'; end if;
  if f.family_id <> t.family_id then raise exception 'Wallets belong to different families'; end if;
  if f.currency <> t.currency then raise exception 'Transfers need the same currency; use an exchange instead'; end if;
  c := _caller(f.family_id);
  if p_amount < 0.01 then raise exception 'Amount is too small'; end if;
  if exists (select 1 from members where removed_at is not null and id in (f.member_id, t.member_id)) then
    raise exception 'This member was removed from the family'; end if;
  ok := _is_admin(c)
     or (f.owner_kind = 'pool'   and t.owner_kind = 'member' and t.member_id = c.id)
     or (f.owner_kind = 'member' and t.owner_kind = 'pool'   and f.member_id = c.id)
     or (f.owner_kind = 'pool'   and t.owner_kind = 'card')
     or (f.owner_kind = 'member' and t.owner_kind = 'card'   and f.member_id = c.id);   -- own wallet -> card (new)
  if not ok then raise exception 'You are not allowed to move money between these wallets' using errcode = '42501'; end if;
  if p_tagged_member_id is not null and t.owner_kind = 'card' then
    if not exists (select 1 from members where id = p_tagged_member_id and family_id = f.family_id and removed_at is null) then
      raise exception 'The tagged member is not part of this family'; end if;
  else
    p_tagged_member_id := null;       -- tags are a label on card top-ups only
  end if;
  perform _lock_accounts(array[p_from, p_to]);
  insert into transfers (family_id, from_account_id, to_account_id, amount, created_by, note, created_at, tagged_member_id)
  values (f.family_id, p_from, p_to, p_amount, c.id, nullif(btrim(p_note),''), v_when, p_tagged_member_id) returning * into r;
  insert into wallet_entries (account_id, amount, created_at, transfer_id) values (p_from, -p_amount, v_when, r.id);
  insert into wallet_entries (account_id, amount, created_at, transfer_id) values (p_to,    p_amount, v_when, r.id);

  if f.owner_kind = 'pool' and t.owner_kind = 'member' then
    insert into notifications (family_id, type, member_id, amount) values (f.family_id, 'member_topup', t.member_id, p_amount);
  elsif f.owner_kind = 'member' and t.owner_kind = 'pool' then
    insert into notifications (family_id, type, member_id, amount) values (f.family_id, 'member_return', f.member_id, p_amount);
  elsif t.owner_kind = 'card' and f.owner_kind in ('pool','member') then
    insert into notifications (family_id, type, member_id, card_id, amount) values (f.family_id, 'card_topup', c.id, t.card_id, p_amount);
  end if;
  perform _settle();
  return r;
end $$;

commit;
