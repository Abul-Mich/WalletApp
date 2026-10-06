-- 0005_card_tags.sql
-- Tag a family member on card transactions.
--   * Card spending: always tagged (defaults to the person logging it). The spend counts
--     toward the TAGGED member's limits, not the logger's.
--   * Card top-ups: optional label only, no effect on limits.
-- Apply together with 0004 on cutover day (or any time after 0003: the old app ignores the new columns).
begin;

alter table card_transactions add column tagged_member_id uuid references members(id);
alter table transfers         add column tagged_member_id uuid references members(id);   -- label on card top-ups only
update card_transactions set tagged_member_id = member_id where tagged_member_id is null;  -- existing spending: tag = who logged it
create index card_transactions_tag_idx on card_transactions (tagged_member_id);

drop function create_transfer(uuid,uuid,numeric,text,timestamptz);
drop function create_card_spend(uuid,numeric,text,numeric,timestamptz);

create function create_transfer(p_from uuid, p_to uuid, p_amount numeric, p_note text default null,
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
     or (f.owner_kind = 'pool'   and t.owner_kind = 'card');
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
  elsif f.owner_kind = 'pool' and t.owner_kind = 'card' then
    insert into notifications (family_id, type, member_id, card_id, amount) values (f.family_id, 'card_topup', c.id, t.card_id, p_amount);
  end if;
  perform _settle();
  return r;
end $$;

create function create_card_spend(p_card_id uuid, p_amount numeric, p_note text default null,
                                  p_lbp_per_usd numeric default null, p_created_at timestamptz default null,
                                  p_tagged_member_id uuid default null)
returns card_transactions
language plpgsql security definer set search_path = public as $$
declare k cards; a wallet_accounts; c members; r card_transactions; v_when timestamptz := coalesce(p_created_at, now()); v_net numeric; v_tag uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than zero'; end if;
  select * into k from cards where id = p_card_id;
  if not found then raise exception 'Card not found'; end if;
  if k.archived then raise exception 'This card is archived and can no longer be used'; end if;
  c := _caller(k.family_id);
  select * into a from wallet_accounts where card_id = k.id;
  -- Who the spending is for. Always set: defaults to the person logging it.
  v_tag := coalesce(p_tagged_member_id, c.id);
  if not exists (select 1 from members where id = v_tag and family_id = k.family_id and removed_at is null) then
    raise exception 'The tagged member is not part of this family'; end if;
  if a.currency = 'USD' then v_net := p_amount;
  else
    perform _check_rate(k.family_id, p_lbp_per_usd, _is_admin(c));
    v_net := round(p_amount / p_lbp_per_usd, 4);
  end if;
  perform _lock_accounts(array[a.id]);
  insert into card_transactions (family_id, card_id, member_id, amount, currency, exchange_rate_to_base, note, created_at, net_usd, tagged_member_id)
  values (k.family_id, k.id, c.id, p_amount, a.currency, v_net / p_amount, nullif(btrim(p_note),''), v_when, v_net, v_tag)
  returning * into r;
  insert into wallet_entries (account_id, amount, created_at, card_txn_id) values (a.id, -p_amount, v_when, r.id);
  insert into notifications (family_id, type, member_id, card_id, amount) values (k.family_id, 'card_withdraw', c.id, k.id, v_net);
  perform _settle();
  return r;
end $$;

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
     where p_category_id is null and family_id = p_family_id and (p_member_id is null or coalesce(tagged_member_id, member_id) = p_member_id)
       and (p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)
  ) s;
  return v;
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_transfer','create_card_spend','period_spend')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

commit;
