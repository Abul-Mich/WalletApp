# Wallet ledger migrations

Run **on a scratch Supabase project first**, never first on the live one.
Everything below runs in the Supabase SQL editor (paste the whole file, press Run).

## Before anything
1. Two dated exports of the live database (SQL data dump + CSVs). Keep them outside this folder.
2. Run `supabase/audit/audit_0000_readonly.sql`; keep its output as the "before" snapshot.

## Scratch project (dry run)
1. Create a second free Supabase project. Restore your data dump into it.
2. Run in order: `0001_ledger_schema.sql`, `0002_backfill.sql`, `0003_money_functions.sql`, `0004_cutover.sql`, `0005_card_tags.sql`, `0006_common_expenses.sql`, `0007_common_paid_from_card.sql`, `0008_card_topup_from_member.sql`, `0009_card_to_wallet.sql`.
   - 0002 ends with one row: `RECONCILED`, family total 2333.31, pool 1727.32, members 580.91, cards 25.08, opening correction 600.92 (your numbers at audit time). Any error means it changed nothing: send me the message.
3. Run `supabase/tests/0001_ledger_tests.sql`. A clean run ends with `ALL TESTS PASSED`.
4. Rehearse rollback: `rollback/0009_down.sql`, `rollback/0008_down.sql`, `rollback/0007_down.sql`, `rollback/0006_down.sql`, `0005_down.sql`, `0004_down.sql`, `0003_down.sql`, `0002_down.sql`, `0001_down.sql` (in that order), then run the audit again: it must equal the "before" snapshot.
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
