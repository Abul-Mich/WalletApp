# Family Wallet — Full Build (Days 1-5 + Planned Payments + Roles/Budget Redesign)

Covers: auth, family create/join, deposits, expense logging (full CRUD), live wallet
balance, multi-currency with bidirectional exchange rates, per-member spending limits,
a family-wide budget target, per-category budgets, superadmin/admin/member roles,
recurring bill tracking, an in-app activity feed, category breakdown, transaction
pagination, and PWA installability.

**Note:** this is the functional build. Styling is intentionally plain (see
`src/index.css`) — you mentioned wanting a separate UI/visual pass, and nothing
structural here should need to change for that; it's CSS/layout on top of a working base.

## 1. Set up Supabase

1. Create a free project at https://supabase.com/dashboard.
2. Open **SQL Editor** → New Query, paste the entire contents of `supabase/schema.sql`,
   and run it. This creates all tables, roles, RLS policies, triggers, and realtime config.
   - **Upgrading an existing database?** Just re-run the same file — the `alter table ...
     add column if not exists` lines make it safe to run on top of an earlier version
     without losing data. Existing families' creators do **not** automatically become
     `superadmin` — see the note at the bottom of this file if you need to fix that.
3. Copy your Project URL and `anon` key from **Project Settings → API**.

## 2. Configure and run

```bash
cp .env.example .env.local
# paste your Project URL and anon key into .env.local
npm install
npm run dev
```

## 3. What changed in this redesign

**Roles: superadmin / admin / member**
- Whoever creates the family becomes `superadmin` — the only role that can't be removed
  or have its role changed by anyone, including itself (enforced by a database trigger,
  not just the UI).
- A superadmin can promote members to `admin` or demote admins back to `member`, under
  **Admin Settings → Manage Admins**. Multiple admins are supported (e.g. both parents).
- `admin` and `superadmin` both get full management access (budgets, categories, limits,
  deposits, exchange rates, invites) — the distinction only matters for role management
  itself and for "can this member be removed."
- A plain member cannot promote themselves — this is blocked at the database level via a
  trigger (`prevent_role_privilege_escalation`), not just hidden in the UI.

**Two separate budget concepts**
- **Family Balance** (unchanged): real cash = total deposits − total spent.
- **Family Budget** (new): a *target* the admin sets for the period (Admin Settings →
  Family Budget), tracked independently of actual deposits. Shows "how much of our
  planned budget is used," even if real cash doesn't match the target exactly.
- **My Balance This Period** (reframed from the old limit-only banner): every member now
  sees a running total of what they've drawn from the budget this period, not just a
  warning when they're close to a cap. If no personal limit is set, this section simply
  doesn't show (there's nothing to track against).
- **Category Budgets** (new): independent per-category caps, unrelated to any member's
  personal limit — set under Admin Settings → Categories & Category Budgets. Two members
  can each be under their own limit while a shared category (e.g. Groceries) is over its
  separate cap, and vice versa — no cross-enforcement between the two tracks, by design.
- No rollover: every period (week/month) starts fresh at zero spent for all three of the
  above. Unused budget doesn't carry into the next period.

**Full transaction CRUD**
- Every transaction in Transaction History now has **Edit** and **Delete** — a member can
  edit/delete their own, an admin/superadmin can edit/delete anyone's. Editing correctly
  re-triggers the wallet balance recalculation (the existing trigger already recomputes
  from source data on any change, so this "just worked" once the RLS policy allowed it).

**Bidirectional exchange rate overrides**
- Admin enters a rate in one direction (e.g. "1 USD = 89500 LBP") and the reverse
  (LBP → USD) is automatically derived and stored too — no need to enter both directions
  manually.

**In-app activity feed ("notify me when someone spends")**
- A live-updating "Recent Activity" list shows the last 10 spend events across the
  family, riding the same realtime channel already used for balance sync — no native
  push notification infrastructure, and effectively no added data cost.

## 4. Test checklist for the new pieces

- Create a family — the creator should show as **superadmin** (purple badge), not admin.
- As superadmin, promote a second member to admin; confirm that member now sees Admin
  Settings. Demote them back; confirm the section disappears for them again.
- Confirm the superadmin never appears in the promote/demote list, and can't be removed.
- Try (via browser devtools, logged in as a plain member) to directly call
  `supabase.from('members').update({ role: 'admin' }).eq('id', <own id>)` — should be
  rejected by the database trigger, not just hidden in the UI.
- Set a Family Budget (e.g. 1000/monthly) — log some expenses, confirm the Family Budget
  card tracks correctly and turns yellow/red near/over the target, independent of the
  actual Family Balance card above it.
- Set a Category Budget on one category — log expenses in and out of that category,
  confirm only that category's spend counts against its own cap.
- Edit a transaction's amount — confirm Family Balance, Category Breakdown, and any
  relevant limit/budget bars all update correctly. Delete a transaction — same check.
- Log an expense as one member while viewing as another (two browser sessions) — confirm
  it appears in Recent Activity live on the other session.
- Set a manual exchange rate override for USD→LBP, then log a transaction in LBP — it
  should convert using the override. Separately confirm a transaction logged in USD converts
  correctly using the auto-derived LBP→USD inverse.

## 5. What's intentionally NOT included

Receipt photos, approval workflows, audit logs, PDF/CSV export, offline conflict
resolution, native push notifications, multi-language localization, native iOS/Android
apps, multi-tenancy, budget rollover/history. See the original project spec's Section
3.6/9 for the full out-of-scope list; none of this new work changes that.

## 6. Migrating an existing family to superadmin

If you already had a family created before this redesign, its creator has role `admin`,
not `superadmin` — there was no superadmin concept yet when they signed up. Fix once,
manually, in the Supabase SQL Editor:

```sql
update members set role = 'superadmin'
where family_id = '<your family id>' and role = 'admin'
order by created_at asc limit 1;
```

Run this once per existing family that needs a superadmin. New families created after
this point get one automatically.

## Project structure recap

```
family-wallet/
├── supabase/schema.sql       # DB schema, roles, RLS, triggers, realtime config
├── public/                   # PWA icons + favicon (placeholders — swap in UI pass)
├── src/
│   ├── lib/                  # exchangeRates.js, spendingLimits.js, budgets.js, roles.js
│   └── pages/                # Login, FamilySetup, Dashboard, and all forms/widgets
```
