# Phone alerts (bill reminders)

Sends one push notification each morning (09:00 Beirut) to every person who turned alerts on, listing bills that are
due within 3 days or overdue (up to 7 days late). Family bills go to admins; a personal bill goes to its owner.

## One-time setup

1. **Apply** `migrations/0016_push_subscriptions.sql` (SQL editor).
2. **Make the keys** (any computer with Node): `npx web-push generate-vapid-keys`
   - the **public** key goes to the app: Vercel env var `VITE_VAPID_PUBLIC_KEY` (and `.env.local` for local runs)
   - the **private** key never goes to the app; it is a Supabase secret (below)
3. **Secrets** (Dashboard → Edge Functions → Secrets, or `supabase secrets set ...`):
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. `mailto:you@example.com`), `CRON_SECRET` (any long random text).
4. **Deploy the function** `send-bill-alerts` with this folder's `index.ts`, with **Verify JWT turned OFF**
   (CLI: `supabase functions deploy send-bill-alerts --no-verify-jwt`). It checks the cron secret / the person's login itself.
5. **Schedule it**: enable the `pg_cron` and `pg_net` extensions (Database → Extensions), then run
   `supabase/push_schedule.example.sql` with your project URL and the same `CRON_SECRET` filled in. Do not commit that filled-in copy.
6. Deploy the app (Vercel), open it on the phone, Profile → "Bill alerts" → Turn on → Send a test.

iPhone: the app must be added to the Home Screen first (iOS 16.4+).

## Testing without waiting for 09:00
Call the function with the cron header and `{"force": true}`; it sends right away to everyone who has alerts on.
