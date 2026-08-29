# Not deployed — dead code

Nothing under `supabase/functions/` runs in this project. There is no
`supabase/config.toml`, and these files are written with a Node/Express
`(req, res)` handler signature, not the Deno `(req: Request) => Response`
signature Supabase Edge Functions actually require.

The real, wired implementations are Next.js API routes:

| This directory | Actual implementation |
|---|---|
| `paystack-webhook/` | `apps/web/src/app/api/paystack-webhook/route.ts` |
| `live-ticket-session/` | `apps/web/src/app/api/live-ticket-session/route.ts` |
| `process-deliveries/` | `apps/web/src/app/api/process-deliveries/route.ts` |
| `process-refunds/` | not yet ported — still dead, out of Day 2 scope |

This was discovered because `live-ticket-session/index.ts` here was
patched for the TOTP decrypt bug (Day 2 Fix 1), but the browser never
called it — it calls the Next.js route, which still had the original
bug until that was found and fixed separately. Treat every file in this
directory as historical/reference only. Recommend deleting this
directory once you've confirmed the Next.js routes cover everything you
need — ask before doing so, since it's a `git rm`, not a code fix.
