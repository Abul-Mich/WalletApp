# Wallet ledger migrations

Run **on a scratch Supabase project first**, never first on the live one.
Everything below runs in the Supabase SQL editor (paste the whole file, press Run).

## Before anything
1. Two dated exports of the live database (SQL data dump + CSVs). Keep them outside this folder.
2. Run `supabase/audit/audit_0000_readonly.sql`; keep its output as the "before" snapshot.

## Scratch project (dry run)
1. Create a second free Supabase project. Restore your data dump into it.
2. Run in order: `0001_ledger_schema.sql`, `0002_backfill.sql`, `0003_money_functions.sql`, `0004_cutover.sql`, `0005_card_tags.sql`, `0006_common_expenses.sql`, `0007_common_paid_from_card.sql`, `0008_card_topup_from_member.sql`, `0009_card_to_wallet.sql`, `0010_card_spend_category.sql`.
   - 0002 ends with one row: `RECONCILED`, family total 2333.31, pool 1727.32, members 580.91, cards 25.08, opening correction 600.92 (your numbers at audit time). Any error means it changed nothing: send me the message.
3. Run `supabase/tests/0001_ledger_tests.sql`. A clean run ends with `ALL TESTS PASSED`.
4. Rehearse rollback: `rollback/0010_down.sql`, `rollback/0009_down.sql`, `rollback/0008_down.sql`, `rollback/0007_down.sql`, `rollback/0006_down.sql`, `0005_down.sql`, `0004_down.sql`, `0003_down.sql`, `0002_down.sql`, `0001_down.sql` (in that order), then run the audit again: it must equal the "before" snapshot.
5. Repeat 2 to 4 once more. Two clean runs in a row = ready.

## Live cutover (same day as the new front end, nobody using the app)
Run 0001, 0002, 0003 first (they change nothing the old app sees), check the `RECONCILED` row, then **only when the new front end is ready to deploy** run 0004 and 0005 together and deploy (the new app needs 0005: it sends the card tag). 0004 re-checks that nothing changed since 0002 and stops with a message if it did (fix: `rollback/0002_down.sql`, then `0002_backfill.sql` again).

## Rollback ladder
| When | Do |
|---|---|
| Before 0004 | `0003_down`, `0002_down`, `0001_down` (old app never changed) |
| After 0004, no new records yet | `0004_down`, redeploy the old front end |
| After 0004, new records exist | export them, `0004_down`, redeploy old front end, re-enter the few new records |
| Anything else | restore the full dump into a fresh project |

## After cutover
Run `supabase/audit/integrity_check.sql` now and then (read-only). No rows returned = healthy.

## Decisions built in
- Only admins add money (deposits); members move money between the pool and their own wallets by transfer.
- A member's LBP/USD rate must be within 10 percent of the family's latest rate (admins only need the allowed range, 1,000 to 10,000,000).
- USD base; every old amount converted to USD at the rate stored on its record (originals kept for display).
- Pool = what the app shows today (1727.32); the 600.92 card-spending gap is one visible `opening_entries` row.
- Card spending stays in `card_transactions` (with `net_usd`); new card spending uses `create_card_spend`.
- Removing a member sets `members.removed_at` (history keeps their name); they must hold 0 first.


**0006 (common expenses):** safe to run any time after 0005; the running app ignores the new tables. Run it BEFORE deploying the front end that shows the Common expenses section. Test on a scratch project first with `tests/0002_common_expense_tests.sql`. Its rollback is only safe before real common expenses exist (it refunds the pool and deletes them).

**0007 (paid from card):** run after 0006, before deploying the front end with the "Paid from" choice. Test with `tests/0003_common_paid_from_card_tests.sql` on scratch first. Its rollback only restores the pool-only functions; expenses already paid from a card stay valid.

**0008 (card top-up from a member wallet):** run after 0005 (independent of 0006/0007). It only widens who may move money onto a card: a member's own wallet is now allowed. Test with `tests/0004_card_topup_source_tests.sql` on scratch first. Note: the test files do not clean up after themselves if a test FAILS midway (they are not wrapped in one transaction), so use a scratch project.

**0009 (card to own wallet):** run after 0008. A member can move card money onto their own wallet (card to pool or to someone else stays admin-only). Test with `tests/0005_card_to_wallet_tests.sql` on scratch first.

**0010 (category on card spending):** run after 0006. Existing card spends keep no category (they show as "Card spending"). Category budgets now include card spending. Test with `tests/0006_card_category_tests.sql` on scratch first. Its rollback drops the column (categories chosen on card spends are lost).

**0011 (spending rollup):** run after 0010, before deploying the front end that uses it (Statistics and the dashboard category breakdown). It only adds one read-only function; no data changes. Test with `tests/0007_spend_rollup_tests.sql` on scratch first. Rollback is `rollback/0011_down.sql`.

**0012 (edit card spending and common expenses):** run after 0010, before deploying the front end with the Edit buttons on those records. Adds two functions, changes no data. Test with `tests/0008_edit_spends_tests.sql` on scratch first (it briefly deposits some LBP into the pool and removes it again). Rollback is `rollback/0012_down.sql`; edits already made keep their new values.

**0013 (pockets):** run after 0012, before deploying the front end with pockets. Adds the `pockets` table (private to the owner and admins), a `pocket` account kind, three functions (`create_pocket`, `rename_pocket`, `set_pocket_archived`) and replaces `create_transfer`, `create_deposit`, `create_exchange` with the same rules plus pocket checks. No existing row changes. Test with `tests/0009_pockets_tests.sql` on scratch first (it moves a little money and puts it back). Rollback is `rollback/0013_down.sql`; it refuses while a pocket holds money or has transfers.

**0014 (money from outside):** run after 0013, before deploying the front end with "Add money". Adds four columns to `deposits` (kind, category_id, note, beneficiary_member_id; old rows stay `deposit`), two functions (`create_income`, `delete_income`), a pocket-aware read rule on deposits, and replaces `spend_rollup` so that reimbursements lower their category's spending and an `income` total is returned. Members add to their own wallet and pockets; admins add to the pool and cards. Salary, bonus, gift and other are "money in"; a reimbursement is not income. Test with `tests/0010_income_tests.sql` on scratch first (it moves a little money and puts it back). Rollback is `rollback/0014_down.sql`; it refuses while income records exist.

- 0015: period_spend (limit gauge, admin limits overview, category and family budgets) also subtracts reimbursements, matching spend_rollup from 0014. Rollback: rollback/0015_down.sql.

- 0016: phone alerts. Adds push_subscriptions (one row per device, closed to the app) plus save_push_subscription / remove_push_subscription. The morning sender is the Edge Function in supabase/functions/send-bill-alerts (setup steps in its README). Rollback: rollback/0016_down.sql.
