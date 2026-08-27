# EvolveIT Memories Platform — Day 1

Section 12 Day 1 only. Do not start Day 2 until `npm run verify:day1` prints `DAY 1 GREEN`.

## What you must do in dashboards (keys are not assumed)

### Supabase
1. SQL Editor → paste and run `supabase/migrations/202608270001_day1_schema_rls.sql`.
2. Authentication → Providers → **Email** enabled. Confirm-email may stay on; bootstrap sets `email_confirm: true`.
3. Leave **Phone OTP** off for Day 1 (your decision: Twilio later).
4. Project Settings → API: copy Project URL, `anon` key, `service_role` key into `.env` (never commit `service_role`).

### Local env
Copy `.env.example` to `.env` and `.env.local` under `apps/web` (Next.js reads `apps/web/.env.local`).

Required:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PLATFORM_PUBLIC_URL` (`http://localhost:3000` for local)
- `DAY1_MANAGER_EMAIL` / `DAY1_MANAGER_PASSWORD`
- `DAY1_TEST_MANAGER_EMAIL` / `DAY1_TEST_MANAGER_PASSWORD` (second tenant, RLS check)

### Commands
```
npm install
npx tsx --env-file=.env scripts/bootstrap-day1.ts
```
Copy `HUB_DEVICE_ID` and `HUB_API_KEY` from bootstrap into `.env`.

```
npm run dev:web
npx tsx --env-file=.env scripts/verify-day1.ts
npm run dev:hub
```

Manager UI: `http://localhost:3000/staff/sign-in`

Vercel and Paystack are not required for Day 1.
