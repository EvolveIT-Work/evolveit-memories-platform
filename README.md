# EvolveIT – Memories Night Club Digital Operations Platform

Cape Coast, Ghana. Multi-tenant venue operations: ticketing, door scanning, F&B, ledger, organiser settlement. Specified in Version 2.0 (final, approved for AI-assisted development).

## Stack

- **Database / Auth / RLS:** PostgreSQL 16 on Supabase  
- **Customer + staff UI:** Next.js 14, React 18 PWAs  
- **Venue hub:** Node.js 22, SQLite (better-sqlite3)  
- **Hosting:** Vercel (web), on-prem hub at the venue  
- **Payments (Day 2+):** Paystack (GHS, MoMo)

## Status

**Day 1 complete.** Schema, FORCE RLS, email/password manager sign-in, device registration (argon2), tenant feature flags, hub hello-world + test snapshot, monitoring skeleton (`/api/health`, hub `/health`).

Acceptance: `DAY 1 GREEN` from `scripts/verify-day1.ts` (manager sign-in, cross-tenant RLS blocked, hub snapshot, ledger immutability).

Do not start Day 2 until that check is green on a given environment.

**Day 3 complete.** Counter/table ordering, bar/kitchen display queue, and cash-order DB functions (`verify:day3`, `verify:day3-display`); waiter table claiming + My Tables/All Tables (`verify:day3-waiter`); table detail + Cash Received (`verify:day3-waiter-cash`); and the waiter PWA UI at `/staff/waiter` (builds clean via `npm run build:web`, not yet manually clicked through). See `docs/EvolveIT_Memories_Platform_Final.md` Section 04/09.

Day 4 not started: lost/stolen ticket recovery, ticket transfer, installment payments, reservation deposits, the organiser portal, and settlement. Day 5 not started: owner dashboard, shift close report, offline drill, second tenant, deployment.

## Full specification

See [docs/EvolveIT_Memories_Platform_Final.md](docs/EvolveIT_Memories_Platform_Final.md).

## Run locally (high level)

1. Apply SQL in `supabase/migrations/` to a Supabase project (Day 1, then the RLS recursion patch).  
2. Copy `.env.example` to `.env` and `apps/web/.env.local`. Fill Supabase URL, anon, and service role. Never commit those files.  
3. `npm install`  
4. `npx tsx --env-file=.env scripts/bootstrap-day1.ts` — store `HUB_DEVICE_ID` / `HUB_API_KEY` in env.  
5. `npm run dev:web` then `npx tsx --env-file=.env scripts/verify-day1.ts`  
6. Optional: `npm run dev:hub`

Details: `DAY1.md`.

## Layout

```
apps/web     Staff Next.js app (sign-in, device register, hub hello API)
apps/hub     Venue hub hello-world
packages/    Shared types; single redeem module (implemented Day 2)
supabase/    Migrations (FORCE RLS, ledger trigger, integer pesewas, UUIDs)
scripts/     Bootstrap + Day 1 verification
docs/        Locked specification
```
