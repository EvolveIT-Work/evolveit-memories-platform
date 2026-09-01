/**
 * Verifies Day 3 Waiter Step 1: table claiming and the My Tables / All
 * Tables views (POST /api/v1/waiter/tables/[tableId]/claim, GET
 * /api/v1/waiter/tables), using real HTTP calls with real Supabase-issued
 * bearer tokens — no direct DB shortcuts for the auth path.
 *
 * Prerequisites:
 *   - `npm run dev:web` running in another terminal
 *   - .env has NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *     SUPABASE_SERVICE_ROLE_KEY
 *   - scripts/bootstrap-day1.ts has been run at least once (this script
 *     signs in as the Day 1 Memories manager for the reassignment check)
 *
 * Run: npx tsx scripts/verify-day3-waiter.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MEMORIES_TENANT_ID } from "@evolveit/shared";

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv(resolve(process.cwd(), ".env"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const platformUrl = process.env.PLATFORM_PUBLIC_URL ?? "http://localhost:3000";
const managerEmail = process.env.DAY1_MANAGER_EMAIL ?? "manager@memories.test";
const managerPassword = process.env.DAY1_MANAGER_PASSWORD;

const results: string[] = [];

function fail(msg: string): never {
  for (const line of results) console.log(line);
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!url || !anonKey || !serviceKey) {
  fail("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
}
if (!managerPassword) fail("Missing DAY1_MANAGER_PASSWORD (set from Day 1 bootstrap)");

const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });

async function createWaiterAndSignIn(): Promise<{ userId: string; token: string }> {
  const email = `verify-waiter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@memories.test`;
  const password = `Verify-${Date.now()}-pw!A1`;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) fail(`createUser failed: ${created.error?.message}`);
  const userId = created.data.user!.id;

  const { error: upsertErr } = await admin
    .from("users")
    .upsert({ id: userId, tenant_id: MEMORIES_TENANT_ID, email, phone: null, display_name: "Verify Waiter" }, { onConflict: "id" });
  if (upsertErr) fail(`users upsert failed: ${upsertErr.message}`);

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert({ user_id: userId, tenant_id: MEMORIES_TENANT_ID, role: "waiter" }, { onConflict: "user_id,tenant_id,role" });
  if (roleErr) fail(`user_roles upsert failed: ${roleErr.message}`);

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) fail(`waiter sign-in failed: ${signInErr?.message}`);

  return { userId, token: signIn.session!.access_token };
}

async function signInManager(): Promise<string> {
  const { data, error } = await anon.auth.signInWithPassword({ email: managerEmail!, password: managerPassword! });
  if (error || !data.session) fail(`manager sign-in failed: ${error?.message}`);
  return data.session!.access_token;
}

async function ensureTestTable(): Promise<string> {
  const { data: created, error } = await admin
    .from("venue_tables")
    .insert({
      tenant_id: MEMORIES_TENANT_ID,
      label: `Verify Waiter Table ${Date.now()}`,
      zone: "main",
      seating_capacity: 4,
      qr_token: `verify-waiter-table-${Date.now()}`,
    })
    .select("id")
    .single();
  if (error || !created) fail(`venue_table insert failed: ${error?.message}`);
  return created!.id as string;
}

async function checkUnauthenticatedRejected(tableId: string) {
  const res = await fetch(new URL(`/api/v1/waiter/tables/${tableId}/claim`, platformUrl), { method: "POST" });
  if (res.status !== 401) fail(`expected 401 with no auth header, got ${res.status}`);
  results.push("CHECK 1 PASS: claim without a bearer token is rejected (401)");
}

async function checkWaiterClaim(tableId: string, waiterToken: string, waiterUserId: string) {
  const res = await fetch(new URL(`/api/v1/waiter/tables/${tableId}/claim`, platformUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${waiterToken}` },
  });
  if (!res.ok) fail(`waiter claim HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const body = await res.json();
  if (body.waiterUserId !== waiterUserId) fail(`expected claim to assign to ${waiterUserId}, got: ${JSON.stringify(body)}`);
  results.push("CHECK 2 PASS: an unassigned table is claimed by the authenticated waiter");
}

async function checkMyTablesListsIt(tableId: string, waiterToken: string) {
  const res = await fetch(new URL("/api/v1/waiter/tables", platformUrl), { headers: { authorization: `Bearer ${waiterToken}` } });
  if (!res.ok) fail(`GET waiter/tables HTTP ${res.status}`);
  const body = (await res.json()) as { tables: Array<{ id: string; status: string }>; scope: string };
  if (body.scope !== "mine") fail(`expected scope 'mine' for a plain waiter, got '${body.scope}'`);
  const found = body.tables.find((t) => t.id === tableId);
  if (!found) fail("claimed table did not appear in the waiter's My Tables list");
  if (found.status !== "grey") fail(`expected 'grey' status for a table with no orders, got '${found.status}'`);
  results.push("CHECK 3 PASS: My Tables (scope=mine) lists the claimed table with 'grey' status (no active orders)");
}

async function checkSecondWaiterCannotSteal(tableId: string) {
  const { userId: secondWaiterId, token: secondToken } = await createWaiterAndSignIn();
  const res = await fetch(new URL(`/api/v1/waiter/tables/${tableId}/claim`, platformUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${secondToken}` },
  });
  if (res.status !== 409) fail(`expected 409 when a second waiter tries to claim an assigned table, got ${res.status}`);
  results.push(`CHECK 4 PASS: a second waiter (${secondWaiterId}) cannot claim an already-assigned table (409)`);
}

async function checkManagerCanReassign(tableId: string, managerToken: string, newWaiterId: string) {
  const res = await fetch(new URL(`/api/v1/waiter/tables/${tableId}/claim`, platformUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${managerToken}`, "content-type": "application/json" },
    body: JSON.stringify({ waiterUserId: newWaiterId }),
  });
  if (!res.ok) fail(`manager reassign HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const body = await res.json();
  if (body.waiterUserId !== newWaiterId) fail(`expected reassignment to ${newWaiterId}, got: ${JSON.stringify(body)}`);
  results.push("CHECK 5 PASS: a manager can reassign an already-claimed table to a different waiter");
}

async function checkManagerSeesAllTables(managerToken: string, tableId: string) {
  const res = await fetch(new URL("/api/v1/waiter/tables", platformUrl), { headers: { authorization: `Bearer ${managerToken}` } });
  if (!res.ok) fail(`GET waiter/tables (manager) HTTP ${res.status}`);
  const body = (await res.json()) as { tables: Array<{ id: string }>; scope: string };
  if (body.scope !== "all") fail(`expected scope 'all' for a manager, got '${body.scope}'`);
  if (!body.tables.some((t) => t.id === tableId)) fail("manager's All Tables view did not include the test table");
  results.push("CHECK 6 PASS: a manager's GET /api/v1/waiter/tables returns the full floor (scope=all), including tables assigned to other waiters");
}

async function main() {
  const tableId = await ensureTestTable();
  await checkUnauthenticatedRejected(tableId);

  const { userId: waiterUserId, token: waiterToken } = await createWaiterAndSignIn();
  await checkWaiterClaim(tableId, waiterToken, waiterUserId);
  await checkMyTablesListsIt(tableId, waiterToken);
  await checkSecondWaiterCannotSteal(tableId);

  const managerToken = await signInManager();
  const { userId: thirdWaiterId } = await createWaiterAndSignIn();
  await checkManagerCanReassign(tableId, managerToken, thirdWaiterId);
  await checkManagerSeesAllTables(managerToken, tableId);

  for (const line of results) console.log(line);
  console.log("DAY 3 WAITER STEP 1 (table claim + My Tables / All Tables) GREEN");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
