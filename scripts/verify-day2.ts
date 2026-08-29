/**
 * Verifies Fix 1 (TOTP decrypt/binary-safety) and Fix 2 (hub sync-pull /
 * sync-push) end to end, using only the real code paths those fixes
 * touched — no reimplemented logic here.
 *
 * Prerequisites:
 *   - `npm run dev:web` running in another terminal (sync-pull/sync-push
 *     are HTTP routes)
 *   - .env has DATABASE_URL, PLATFORM_AES_KEY_B64, HUB_DEVICE_ID,
 *     HUB_API_KEY already set (per the Fix 1/2 setup)
 *   - scripts/bootstrap-day1.ts has been run at least once (creates the
 *     Memories manager user and hub device this script reuses)
 *
 * Run: npx tsx scripts/verify-day2.ts
 */
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { randomBytes, createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  MEMORIES_TENANT_ID,
  encryptTotpSecret,
  decryptTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  redeemTicket,
  createPostgresRedeemAdapter,
  type PostgresLikeClient,
} from "@evolveit/shared";

// Minimal .env loader (repo root) so `npx tsx scripts/verify-day2.ts` works
// standalone — Node does not read .env automatically, and this repo has
// no dotenv dependency. Does not override variables already set in the
// shell environment.
function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(resolve(process.cwd(), ".env"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.DATABASE_URL;
const platformKeyB64 = process.env.PLATFORM_AES_KEY_B64;
const platformUrl = process.env.PLATFORM_PUBLIC_URL ?? "http://localhost:3000";
const hubDeviceId = process.env.HUB_DEVICE_ID;
const hubApiKey = process.env.HUB_API_KEY;

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!url || !service) fail("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
if (!databaseUrl) fail("Missing DATABASE_URL");
if (!platformKeyB64) fail("Missing PLATFORM_AES_KEY_B64");
if (!hubDeviceId || !hubApiKey) fail("Missing HUB_DEVICE_ID / HUB_API_KEY");

const platformKey = Buffer.from(platformKeyB64, "base64");
const admin = createClient(url, service, { auth: { persistSession: false } });
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const pgClient: PostgresLikeClient = {
  async query(sql, params) {
    const result = await pool.query(sql, params as unknown[]);
    return { rows: result.rows as Record<string, unknown>[] };
  },
};

const results: string[] = [];
const hubAuthHeader = `Device ${hubDeviceId}.${hubApiKey}`;

async function getFixtureIds() {
  const { data: user, error: userErr } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", MEMORIES_TENANT_ID)
    .limit(1)
    .maybeSingle();
  if (userErr || !user) fail(`no user found for tenant — run bootstrap-day1 first: ${userErr?.message}`);

  let { data: event } = await admin
    .from("events")
    .select("id")
    .eq("tenant_id", MEMORIES_TENANT_ID)
    .limit(1)
    .maybeSingle();

  if (!event) {
    const now = Date.now();
    const { data: created, error: evErr } = await admin
      .from("events")
      .insert({
        tenant_id: MEMORIES_TENANT_ID,
        name: "Verify Day2 Test Event",
        starts_at: new Date(now).toISOString(),
        ends_at: new Date(now + 6 * 3600_000).toISOString(),
        check_in_from: new Date(now - 3600_000).toISOString(),
        check_in_until: new Date(now + 6 * 3600_000).toISOString(),
      })
      .select("id")
      .single();
    if (evErr || !created) fail(`event insert failed: ${evErr?.message}`);
    event = created;
  }

  let { data: ticketType } = await admin
    .from("ticket_types")
    .select("id")
    .eq("event_id", event!.id)
    .limit(1)
    .maybeSingle();

  if (!ticketType) {
    const { data: created, error: ttErr } = await admin
      .from("ticket_types")
      .insert({
        tenant_id: MEMORIES_TENANT_ID,
        event_id: event!.id,
        name: "Verify Day2 GA",
        price_pesewas: 5000,
        remaining: 1000,
      })
      .select("id")
      .single();
    if (ttErr || !created) fail(`ticket_type insert failed: ${ttErr?.message}`);
    ticketType = created;
  }

  return { userId: user.id as string, eventId: event!.id as string, ticketTypeId: ticketType!.id as string };
}

async function issueTestTicket(ticketTypeId: string, userId: string, eventId: string) {
  const rawSecret = randomBytes(20);
  const encrypted = encryptTotpSecret(rawSecret, platformKey);
  const { rows } = await pgClient.query(
    `INSERT INTO tickets (tenant_id, event_id, ticket_type_id, buyer_user_id, serial, status, totp_secret_enc)
     VALUES ($1, $2, $3, $4, $5, 'issued', $6)
     RETURNING id`,
    [MEMORIES_TENANT_ID, eventId, ticketTypeId, userId, `VERIFY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, encrypted.toString("base64")],
  );
  return { ticketId: rows[0].id as string, rawSecret };
}

async function checkDecryptRoundTrip(ticketId: string, rawSecret: Buffer) {
  const { rows } = await pgClient.query(`SELECT totp_secret_enc FROM tickets WHERE id = $1`, [ticketId]);
  const storedB64 = rows[0].totp_secret_enc as string;
  const decrypted = decryptTotpSecret(Buffer.from(storedB64, "base64"), platformKey);
  if (Buffer.compare(decrypted, rawSecret) !== 0) {
    fail("decryptTotpSecret did not recover the original raw secret bytes — Fix 1 binary-safety broken");
  }
  results.push("CHECK 1 PASS: encrypt -> DB column -> decrypt round-trips to the exact original bytes");
}

async function checkSyncPull(ticketId: string, rawSecret: Buffer) {
  const res = await fetch(new URL("/api/v1/hub/sync-pull", platformUrl), {
    headers: { authorization: hubAuthHeader },
  });
  if (!res.ok) fail(`sync-pull HTTP ${res.status} — is the web app running at ${platformUrl}?`);
  const body = (await res.json()) as { tickets: Array<{ id: string; holder_name: string; ticket_type: string; totp_secret: string }> };
  const found = body.tickets.find((t) => t.id === ticketId);
  if (!found) fail("sync-pull did not return the freshly issued test ticket");
  if (!found.holder_name || !found.ticket_type) fail("sync-pull ticket is missing holder_name/ticket_type (join broken)");

  const pulledSecret = Buffer.from(found.totp_secret, "base64");
  if (Buffer.compare(pulledSecret, rawSecret) !== 0) {
    fail("sync-pull's decrypted secret does not match the original raw secret bytes");
  }

  const code = generateTotpCode(pulledSecret);
  if (!verifyTotpCode(pulledSecret, code)) {
    fail("a code generated from sync-pull's secret does not verify against that same secret");
  }
  results.push("CHECK 2 PASS: sync-pull returns correct holder_name/ticket_type and a usable, correctly decrypted secret");
}

async function ensureScopedDoorDevice(eventId: string): Promise<string> {
  // redeemTicket() enforces device event-scoping (event_ids) on whatever
  // device performs the scan — the hub device itself is not scoped to any
  // particular event, so a redeem attempt "as the hub" always fails
  // wrong_event. A real door scanner authenticates with its own device
  // row (Appendix A); we create one here scoped to our test event. This
  // device is never used over HTTP, so credential_hash is a placeholder.
  const { rows } = await pgClient.query(
    `INSERT INTO devices (tenant_id, role, label, event_ids, credential_hash)
     VALUES ($1, 'door', 'Verify Day2 Door', ARRAY[$2]::uuid[], 'unused-verify-script-placeholder')
     RETURNING id`,
    [MEMORIES_TENANT_ID, eventId],
  );
  return rows[0].id as string;
}

async function checkCloudRedeem(ticketId: string, rawSecret: Buffer, eventId: string) {
  const adapter = createPostgresRedeemAdapter(pgClient, platformKey);
  const deviceId = await ensureScopedDoorDevice(eventId);

  const code1 = generateTotpCode(rawSecret);
  const first = await redeemTicket({ ticketId, totpCode: code1, deviceId }, adapter);
  if (first.outcome !== "admit") fail(`expected first scan to admit, got: ${JSON.stringify(first)}`);

  const code2 = generateTotpCode(rawSecret);
  const second = await redeemTicket({ ticketId, totpCode: code2, deviceId }, adapter);
  if (second.outcome !== "already_used") fail(`expected second scan to be already_used, got: ${JSON.stringify(second)}`);

  results.push("CHECK 3 PASS: cloud-direct redeemTicket admits once, then correctly reports already_used (CAS + fixed postgres adapter)");
}

async function checkSyncPush(ticketId: string) {
  const row = {
    id: 1,
    ticket_id: ticketId,
    device_id: hubDeviceId,
    scanned_by: null,
    door_label: "Door 1",
    scanned_at: new Date().toISOString(),
  };

  const first = await fetch(new URL("/api/v1/hub/sync-push", platformUrl), {
    method: "POST",
    headers: { authorization: hubAuthHeader, "content-type": "application/json" },
    body: JSON.stringify({ redemptions: [row] }),
  });
  if (!first.ok) fail(`sync-push HTTP ${first.status}`);
  const firstBody = (await first.json()) as { results: Array<{ id: number; outcome: string }> };
  if (firstBody.results[0]?.outcome !== "admitted") {
    fail(`expected sync-push replay to admit, got: ${JSON.stringify(firstBody)}`);
  }

  const second = await fetch(new URL("/api/v1/hub/sync-push", platformUrl), {
    method: "POST",
    headers: { authorization: hubAuthHeader, "content-type": "application/json" },
    body: JSON.stringify({ redemptions: [row] }),
  });
  const secondBody = (await second.json()) as { results: Array<{ id: number; outcome: string }> };
  if (secondBody.results[0]?.outcome !== "already_used") {
    fail(`expected replay of the same row to be already_used (idempotent), got: ${JSON.stringify(secondBody)}`);
  }

  results.push("CHECK 4 PASS: sync-push admits an offline redemption once, then correctly reports already_used on replay");
}

async function checkPaystackWebhookIssuesRealTicket(userId: string, ticketTypeId: string) {
  const paystackSecret = process.env.PAYSTACK_SECRET;
  if (!paystackSecret) {
    console.log("SKIP CHECK 5: PAYSTACK_SECRET not set — cannot sign a realistic webhook payload");
    return;
  }

  const reference = `verify-day2-${Date.now()}`;
  const body = JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      amount: 5000,
      status: "success",
      metadata: {
        tenant_id: MEMORIES_TENANT_ID,
        buyer_user_id: userId,
        ticket_type_id: ticketTypeId,
        qty: 1,
      },
    },
  });

  const signature = createHmac("sha512", paystackSecret).update(body).digest("hex");

  const res = await fetch(new URL("/api/paystack-webhook", platformUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": signature },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    fail(`paystack-webhook HTTP ${res.status}: ${text}`);
  }

  const { rows } = await pgClient.query(
    `SELECT t.id, t.status, t.totp_secret_enc FROM tickets t
     JOIN ticket_payments tp ON tp.ticket_id = t.id
     WHERE tp.paystack_ref = $1`,
    [reference],
  );
  if (rows.length !== 1) fail(`expected exactly one ticket issued for reference ${reference}, got ${rows.length}`);
  const issued = rows[0] as { id: string; status: string; totp_secret_enc: string };
  if (issued.status !== "issued") fail(`expected issued ticket status 'issued', got '${issued.status}'`);
  if (!issued.totp_secret_enc) fail("issued ticket has no totp_secret_enc");

  // A real Paystack test payment, HMAC-signed exactly as Paystack signs
  // it, produced a real ticket via the actual RPC transaction — not a
  // direct pg insert bypassing that path like the earlier checks.
  const decrypted = decryptTotpSecret(Buffer.from(issued.totp_secret_enc, "base64"), platformKey);
  const code = generateTotpCode(decrypted);
  if (!verifyTotpCode(decrypted, code)) fail("secret from a real webhook-issued ticket does not verify");

  results.push(`CHECK 5 PASS: a real, HMAC-signed Paystack webhook call issued ticket ${issued.id} via issue_tickets_for_payment, with a usable secret`);
}

async function checkGenuineConcurrency(ticketTypeId: string, userId: string, eventId: string) {
  const doorDeviceId = await ensureScopedDoorDevice(eventId);
  const { ticketId, rawSecret } = await issueTestTicket(ticketTypeId, userId, eventId);
  const adapter = createPostgresRedeemAdapter(pgClient, platformKey);

  // Both requests use codes valid for the current 30s window and fire
  // truly in parallel (no await between them) — this is what the CAS
  // unique constraint has to withstand, not two sequential calls.
  const code = generateTotpCode(rawSecret);
  const [a, b] = await Promise.all([
    redeemTicket({ ticketId, totpCode: code, deviceId: doorDeviceId }, adapter),
    redeemTicket({ ticketId, totpCode: code, deviceId: doorDeviceId }, adapter),
  ]);

  const outcomes = [a.outcome, b.outcome].sort();
  if (JSON.stringify(outcomes) !== JSON.stringify(["admit", "already_used"])) {
    fail(`expected exactly one admit and one already_used from simultaneous scans, got: ${JSON.stringify([a, b])}`);
  }

  results.push("CHECK 6 PASS: two genuinely simultaneous scans (Promise.all, no sequencing) admit exactly one");
}

async function main() {
  const { userId, eventId, ticketTypeId } = await getFixtureIds();

  const ticketA = await issueTestTicket(ticketTypeId, userId, eventId);
  await checkDecryptRoundTrip(ticketA.ticketId, ticketA.rawSecret);
  await checkSyncPull(ticketA.ticketId, ticketA.rawSecret);
  await checkCloudRedeem(ticketA.ticketId, ticketA.rawSecret, eventId);

  const ticketB = await issueTestTicket(ticketTypeId, userId, eventId);
  await checkSyncPush(ticketB.ticketId);

  await checkPaystackWebhookIssuesRealTicket(userId, ticketTypeId);
  await checkGenuineConcurrency(ticketTypeId, userId, eventId);

  for (const line of results) console.log(line);
  console.log("DAY 2 (Fix 1 + Fix 2) GREEN");
  console.log(`Test tickets created (not cleaned up): ${ticketA.ticketId}, ${ticketB.ticketId}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
