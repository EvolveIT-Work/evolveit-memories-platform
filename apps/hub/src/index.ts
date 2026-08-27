/**
 * Venue hub hello-world (Section 12 Day 1).
 * Connects to Supabase (health) and fetches a test snapshot via device auth.
 * redeemTicket is imported from the shared module only (Appendix B #8) — not used until Day 2.
 */
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import Database from "better-sqlite3";
import pino from "pino";
import type { HubTestSnapshot } from "@evolveit/shared";
import { redeemTicket } from "@evolveit/redeem";

export { redeemTicket };

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

const PLATFORM_URL = process.env.PLATFORM_PUBLIC_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const HUB_DEVICE_ID = process.env.HUB_DEVICE_ID;
const HUB_API_KEY = process.env.HUB_API_KEY;
const PORT = Number(process.env.HUB_PORT ?? 8787);

if (!PLATFORM_URL || !SUPABASE_URL || !SUPABASE_ANON_KEY || !HUB_DEVICE_ID || !HUB_API_KEY) {
  log.error(
    "Missing hub env: PLATFORM_PUBLIC_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, HUB_DEVICE_ID, HUB_API_KEY",
  );
  process.exit(1);
}

mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
const db = new Database(path.join(process.cwd(), "data", "hub.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS snapshot_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    received_at TEXT NOT NULL,
    ticket_count INTEGER NOT NULL,
    revocation_count INTEGER NOT NULL,
    tenant_id TEXT NOT NULL
  );
`);

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let lastSnapshot: HubTestSnapshot | null = null;
let lastError: string | null = null;

async function hello(): Promise<HubTestSnapshot> {
  const health = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
    headers: { apikey: SUPABASE_ANON_KEY },
  });
  if (!health.ok) {
    throw new Error(`supabase_health_${health.status}`);
  }

  const res = await fetch(`${PLATFORM_URL}/api/v1/hub/hello`, {
    method: "POST",
    headers: {
      authorization: `Device ${HUB_DEVICE_ID}.${HUB_API_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`hub_hello_${res.status}`);
  }
  const body = (await res.json()) as { snapshot: HubTestSnapshot };
  const snapshot = body.snapshot;
  db.prepare(
    `INSERT INTO snapshot_cache (id, received_at, ticket_count, revocation_count, tenant_id)
     VALUES (1, @received_at, @ticket_count, @revocation_count, @tenant_id)
     ON CONFLICT(id) DO UPDATE SET
       received_at = excluded.received_at,
       ticket_count = excluded.ticket_count,
       revocation_count = excluded.revocation_count,
       tenant_id = excluded.tenant_id`,
  ).run({
    received_at: snapshot.generated_at,
    ticket_count: snapshot.ticket_count,
    revocation_count: snapshot.revocation_count,
    tenant_id: snapshot.tenant_id,
  });
  log.info({
    msg: "hub_snapshot_ok",
    tenant_id: snapshot.tenant_id,
    ticket_count: snapshot.ticket_count,
    supabase_ok: true,
  });
  return snapshot;
}

const server = createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "evolveit-hub",
        day: 1,
        last_snapshot_at: lastSnapshot?.generated_at ?? null,
        last_error: lastError,
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, async () => {
  log.info({ msg: "hub_listen", port: PORT });
  try {
    lastSnapshot = await hello();
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : "unknown";
    log.error({ msg: "hub_hello_failed", err: lastError });
  }
});
