-- ============================================================================
-- Spend rollup tests for the Supabase SQL editor. SCRATCH project only, after 0001-0011.
-- Compares spend_rollup() with plain sums over the three tables. Read-only: creates nothing.
-- A failure shows an error starting with "TEST FAILED".
-- ============================================================================
do $$
declare fam uuid; r jsonb; direct numeric; n bigint; dsum numeric; csum numeric; psum numeric; m uuid; mdirect numeric; mr jsonb; w timestamptz;
begin
  select family_id into fam from members where role = 'superadmin' and removed_at is null order by created_at limit 1;
  if fam is null then raise exception 'TEST FAILED: no superadmin family found'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', (select user_id from members where role='superadmin' and removed_at is null order by created_at limit 1), 'role','authenticated')::text, false);
  set local role authenticated;

  r := spend_rollup(fam);
  select coalesce(sum(coalesce(net_usd, amount*exchange_rate_to_base)),0) into direct from transactions where family_id = fam;
  direct := direct + (select coalesce(sum(coalesce(net_usd, amount*exchange_rate_to_base)),0) from card_transactions where family_id = fam)
                   + (select coalesce(sum(net_usd),0) from common_expenses where family_id = fam);
  n := (select count(*) from transactions where family_id = fam) + (select count(*) from card_transactions where family_id = fam)
     + (select count(*) from common_expenses where family_id = fam);
  if abs((r->>'total')::numeric - direct) > 0.001 then raise exception 'TEST FAILED: total % <> direct %', r->>'total', direct; end if;
  if (r->>'count')::bigint <> n then raise exception 'TEST FAILED: count % <> %', r->>'count', n; end if;

  select coalesce(sum((x->>'total')::numeric),0) into dsum from jsonb_array_elements(r->'daily') x;
  select coalesce(sum((x->>'total')::numeric),0) into csum from jsonb_array_elements(r->'categories') x;
  select coalesce(sum((x->>'total')::numeric),0) into psum from jsonb_array_elements(r->'people') x;
  if abs(dsum - direct) > 0.001 or abs(csum - direct) > 0.001 or abs(psum - direct) > 0.001 then
    raise exception 'TEST FAILED: parts do not add up (daily %, categories %, people %, total %)', dsum, csum, psum, direct;
  end if;

  -- one member, by tag
  select id into m from members where family_id = fam and removed_at is null order by created_at limit 1;
  mr := spend_rollup(fam, null, null, m);
  mdirect := (select coalesce(sum(coalesce(net_usd, amount*exchange_rate_to_base)),0) from transactions where family_id = fam and member_id = m)
           + (select coalesce(sum(coalesce(net_usd, amount*exchange_rate_to_base)),0) from card_transactions where family_id = fam and coalesce(tagged_member_id, member_id) = m)
           + (select coalesce(sum(net_usd),0) from common_expenses where family_id = fam and tagged_member_id = m);
  if abs((mr->>'total')::numeric - mdirect) > 0.001 then raise exception 'TEST FAILED: member total % <> %', mr->>'total', mdirect; end if;

  -- a period: this month so far must not exceed all time, an empty period gives zero
  w := now() - interval '30 days';
  if (spend_rollup(fam, w, now() + interval '1 day')->>'total')::numeric > (r->>'total')::numeric + 0.001 then
    raise exception 'TEST FAILED: period total above all-time total'; end if;
  if (spend_rollup(fam, now() + interval '10 days', now() + interval '11 days')->>'count')::int <> 0 then
    raise exception 'TEST FAILED: empty period should have no records'; end if;

  reset role;
  raise notice 'spend_rollup tests passed (family total %, % records)', direct, n;
end $$;
