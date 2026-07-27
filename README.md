# Family Wallet — Day 5 (Complete Build)

All 5 days are now implemented: auth, family create/join, deposits, expense logging,
live wallet balance, multi-currency with exchange rates, per-member spending limits,
admin controls, category breakdown, transaction pagination, and PWA installability.

See `family-wallet-project-spec.md` (in the project) for full requirements and rationale.
**Note:** this is the functional build — you mentioned wanting to do a UI/visual pass
separately, so styling is intentionally plain/functional right now (see `src/index.css`).
Nothing below should need to change structurally for that pass; it's just CSS + maybe
component layout tweaks on top of this working base.

## 1. Create your Supabase project

1. Go to https://supabase.com/dashboard → New Project (free tier).
2. Open **SQL Editor** → New Query, paste the entire contents of `supabase/schema.sql`,
   and run it. This creates all tables, RLS policies, triggers, and enables Realtime.
3. Go to **Project Settings → API** and copy the Project URL and `anon` public key.
4. Go to **Authentication → URL Configuration** and set **Site URL** to your local dev
   URL for now (`http://localhost:5173`) — you'll update this to your real deployed URL
   after Step 3 below.

## 2. Configure and run locally

```bash
cp .env.example .env.local
# paste your Project URL and anon key into .env.local
npm install
npm run dev
```

## 3. Deploy to Vercel (free tier)

1. Push this project to a GitHub repo (Vercel deploys from Git).
2. Go to https://vercel.com → **Add New → Project** → import the repo.
3. Vercel auto-detects Vite; no config changes needed. Before deploying, add your
   environment variables under **Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. You'll get a `*.vercel.app` URL.
5. Go back to Supabase → **Authentication → URL Configuration** and update **Site URL**
   to your real `https://your-app.vercel.app` URL (otherwise magic links / signup
   confirmation emails will redirect to localhost).
6. On your phone, open the Vercel URL in Safari (iOS) or Chrome (Android) and use
   **Add to Home Screen** — this installs it as a PWA with its own icon, matching the
   "installable on iOS and Android" requirement without an app store submission.

## 4. Full end-to-end test checklist

**Auth & family setup**
- Sign up, create a family (become admin) — 5 default categories + invite code appear
- Second account joins via invite code — member list updates live on the admin's screen

**Wallet & transactions**
- Admin deposits funds → balance updates live for all members
- Any member logs an expense → balance drops, appears at top of Transaction History
- Log 25+ transactions, confirm the list initially shows 20 and a **"Load 20 More"**
  button appears; clicking it loads the next page and then disappears once you've
  reached the end of history (FR13)

**Multi-currency**
- Log a deposit/expense in a non-base currency → converts correctly, shows both amounts
- Admin sets a manual exchange rate override → subsequent transactions in that currency
  use it instead of the live rate
- Confirm past transactions don't change value after setting a new override (rate
  snapshotting, FR18)

**Limits & admin controls**
- Admin sets a per-member limit → that member sees the warning banner at 80%+ and 100%+
- Admin's own dashboard shows a Family Limit Status bar for every member with a limit set
- Admin adds/removes custom categories → reflected live in the expense-logging dropdown
  for all members; default categories can't be removed

**PWA / mobile**
- On a phone browser, "Add to Home Screen" — icon should appear correctly (not a generic
  browser icon), and launching from the home screen should open without browser chrome
  (standalone mode)
- Reload the app after first load — should be fast (cached app shell), only data calls
  should hit the network (check via browser dev tools Network tab, or a phone's data
  usage stats over a day of normal use)

**Security (RLS)**
- Try acting as a non-admin and attempt to set someone else's spending limit or insert a
  deposit directly (e.g. via browser console using the exposed `window.supabase` in
  dev mode) — should be rejected by RLS, not just hidden in the UI

## 5. What's intentionally NOT included (per the spec's Section 3.6 / Section 9)

Receipt photos, approval workflows, audit logs, PDF/CSV export, offline conflict
resolution, native push notifications, multi-language localization, native iOS/Android
apps, multi-tenancy, and anything else listed as out-of-scope in the project spec. None
of these should be added without deciding to expand scope first.

## 6. Known placeholders to revisit in the UI/visual pass

- `public/icon-192.png`, `public/icon-512.png`, `public/favicon.svg` are simple
  programmatically-generated placeholders (dark background + blue wallet shape) — swap
  these for real designed icons whenever you do the visual pass.
- `src/index.css` is plain/functional (dark theme, system font, minimal styling) —
  this is the point where a design pass would start.
- The 4-currency list (`SUPPORTED_CURRENCIES` in `src/lib/exchangeRates.js`) and the
  4 open decisions from the spec's Section 10 are worth a final confirmation pass too.

## Project structure recap

```
family-wallet/
├── supabase/schema.sql       # DB schema, RLS, triggers, realtime config
├── public/                   # PWA icons + favicon
├── src/
│   ├── lib/                  # exchangeRates.js, spendingLimits.js — pure logic
│   └── pages/                # Login, FamilySetup, Dashboard, and all forms/widgets
```
