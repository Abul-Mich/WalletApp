-- ============================================================================
-- 0016 · Phone alerts (Web Push): where each person's devices are registered.
--  * push_subscriptions holds one row per device (the push address the phone gave the app + its keys).
--  * Only two functions write to it, and only for the signed-in person: save_push_subscription (turn alerts on
--    for this device) and remove_push_subscription (turn them off). The table itself is closed to the app:
--    nobody can read other people's device addresses; only the alert sender (service role) reads them.
--  * No existing table changes. Needs 0001. Rollback: rollback/0016_down.sql.
-- ============================================================================
begin;

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  member_id   uuid not null references members(id)  on delete cascade,
  user_id     uuid not null,
  endpoint    text not null unique check (endpoint like 'https://%'),
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);
create index push_subscriptions_member_idx on push_subscriptions (member_id);

alter table push_subscriptions enable row level security;
revoke all on push_subscriptions from anon, authenticated;   -- no policies: the app never reads or writes it directly

create function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m members;
begin
  select * into m from members where user_id = auth.uid() and removed_at is null order by created_at limit 1;
  if not found then raise exception 'You are not part of a family' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or length(p_endpoint) > 1000 then raise exception 'Invalid device address'; end if;
  if nullif(p_p256dh, '') is null or nullif(p_auth, '') is null then raise exception 'Invalid device keys'; end if;
  insert into push_subscriptions (family_id, member_id, user_id, endpoint, p256dh, auth, user_agent)
  values (m.family_id, m.id, auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
     set family_id = excluded.family_id, member_id = excluded.member_id, user_id = excluded.user_id,
         p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, created_at = now();
end $$;

create function remove_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke all on function save_push_subscription(text, text, text, text) from public, anon;
revoke all on function remove_push_subscription(text) from public, anon;
grant execute on function save_push_subscription(text, text, text, text) to authenticated;
grant execute on function remove_push_subscription(text) to authenticated;

commit;
