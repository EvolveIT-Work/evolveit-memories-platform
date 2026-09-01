/**
 * Verifies Day 3 Waiter Step 2: table detail (GET
 * /api/v1/waiter/tables/[tableId]) and the Cash Received action (POST
 * /api/v1/waiter/orders/[orderId]/cash-received), using the real
 * /api/order/start-cash-order route to create the pending cash order —
 * no direct DB shortcuts for the parts under test.
 *
 * Prerequisites: same as verify-day3-waiter.ts (dev:web running, .env
 * set, bootstrap-day1 already run for DAY1_MANAGER_PASSWORD).
 *
 * Run: npx tsx scripts/verify-day3-waiter-cash.ts
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

const results: string[] = [];

function fail(msg: string): never {
  for (const line of results) console.log(line);
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!url || !anonKey || !serviceKey) {
  fail("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(url!, serviceKey!, { auth: { persistSession: false } });
const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });

async function createWaiterAndSignIn(): Promise<{ userId: string; token: string }> {
  const email = `verify-waiter-cash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@memories.test`;
  const password = `Verify-${Date.now()}-pw!A1`;

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) fail(`createUser failed: ${created.error?.message}`);
  const userId = created.data.user!.id;

  const { error: upsertErr } = await admin
    .from("users")
    .upsert({ id: userId, tenant_id: MEMORIES_TENANT_ID, email, phone: null, display_name: "Verify Waiter Cash" }, { onConflict: "id" });
  if (upsertErr) fail(`users upsert failed: ${upsertErr.message}`);

  const { error: roleErr } = await admin
    .from("user_roles")
    .upsert({ user_id: userId, tenant_id: MEMORIES_TENANT_ID, role: "waiter" }, { onConflict: "user_id,tenant_id,role" });
  if (roleErr) fail(`user_roles upsert failed: ${roleErr.message}`);

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) fail(`waiter sign-in failed: ${signInErr?.message}`);

  return { userId, token: signIn.session!.access_token };
}

async function ensureFixtures() {
  const { data: table, error: tableErr } = await admin
    .from("venue_tables")
    .insert({
      tenant_id: MEMORIES_TENANT_ID,
      label: `Verify Cash Table ${Date.now()}`,
      zone: "main",
      seating_capacity: 4,
      qr_token: `verify-cash-table-${Date.now()}`,
    })
    .select("id, qr_token")
    .single();
  if (tableErr || !table) fail(`venue_table insert failed: ${tableErr?.message}`);

  const { data: menuItem, error: itemErr } = await admin
    .from("menu_items")
    .insert({ tenant_id: MEMORIES_TENANT_ID, name: "Verify Cash Beer", station: "bar", price_pesewas: 4000, in_stock: true })
    .select("id")
    .single();
  if (itemErr || !menuItem) fail(`menu_item insert failed: ${itemErr?.message}`);

  return { tableId: table!.id as string, tableQrToken: table!.qr_token as string, menuItemId: menuItem!.id as string };
}

async function createPendingCashOrder(tableQrToken: string, menuItemId: string): Promise<string> {
  const res = await fetch(new URL("/api/order/start-cash-order", platformUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: tableQrToken,
      customer_phone: "+233200000099",
      items: [{ menu_item_id: menuItemId, qty: 2 }],
    }),
  });
  if (!res.ok) fail(`start-cash-order HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { order_id: string; amount_pesewas: number };
  if (body.amount_pesewas !== 8000) fail(`expected cash order total 8000, got ${body.amount_pesewas}`);
  return body.order_id;
}

async function checkTableDetailShowsPendingCash(tableId: string, waiterToken: string, orderId: string) {
  const res = await fetch(new URL(`/api/v1/waiter/tables/${tableId}`, platformUrl), {
    headers: { authorization: `Bearer ${waiterToken}` },
  });
  if (!res.ok) fail(`GET table detail HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as {
    orders: Array<{ id: string; paymentSource: string; status: string; needsCashConfirmation: boolean; items: Array<{ qty: number }> }>;
  };
  const order = body.orders.find((o) => o.id === orderId);
  if (!order) fail("pending cash order did not appear in table detail");
  if (order.paymentSource !== "cash") fail(`expected paymentSource 'cash', got '${order.paymentSource}'`);
  if (!order.needsCashConfirmation) fail("expected needsCashConfirmation=true for a pending_pay cash order");
  if (order.items.length !== 1 || order.items[0].qty !== 2) fail(`unexpected items: ${JSON.stringify(order.items)}`);
  results.push("CHECK 1 PASS: table detail shows the pending cash order with needsCashConfirmation=true and correct items");
}

async function checkUnassignedWaiterForbidden(tableId: string, orderId: string) {
  const { token: otherToken } = await createWaiterAndSignIn();
  const res = await fetch(new URL(`/api/v1/waiter/tables/${tableId}`, platformUrl), {
    headers: { authorization: `Bearer ${otherToken}` },
  });
  if (res.status !== 403) fail(`expected 403 for a waiter not assigned to the table, got ${res.status}`);

  const cashRes = await fetch(new URL(`/api/v1/waiter/orders/${orderId}/cash-received`, platformUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${otherToken}`, "content-type": "application/json" },
    body: JSON.stringify({ cashAmountPesewas: 8000 }),
  });
  if (cashRes.status !== 403) fail(`expected 403 confirming cash on an unassigned table, got ${cashRes.status}`);
  results.push("CHECK 2 PASS: a waiter not assigned to the table cannot view its detail or confirm its cash (403 both)");
}

async function checkCashReceivedConfirms(orderId: string, waiterToken: string, waiterUserId: string) {
  const res = await fetch(new URL(`/api/v1/waiter/orders/${orderId}/cash-received`, platformUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${waiterToken}`, "content-type": "application/json" },
    body: JSON.stringify({ cashAmountPesewas: 8000 }),
  });
  if (!res.ok) fail(`cash-received HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const body = await res.json();
  if (body.status !== "ok") fail(`expected status 'ok', got: ${JSON.stringify(body)}`);

  const { data: order, error: orderErr } = await admin.from("orders").select("status").eq("id", orderId).single();
  if (orderErr || !order) fail(`could not re-read order: ${orderErr?.message}`);
  if (order.status !== "paid") fail(`expected order status 'paid' after cash-received, got '${order.status}'`);

  const { data: movement, error: moveErr } = await admin
    .from("cash_movements")
    .select("attributed_waiter_id, order_id, amount_pesewas")
    .eq("order_id", orderId)
    .maybeSingle();
  if (moveErr || !movement) fail(`no cash_movements row found for order: ${moveErr?.message}`);
  if (movement.attributed_waiter_id !== waiterUserId) fail(`cash_movements attributed to wrong waiter: ${movement.attributed_waiter_id}`);
  if (movement.amount_pesewas !== 8000) fail(`expected cash_movements amount 8000, got ${movement.amount_pesewas}`);

  const { data: ledgerRow, error: ledgerErr } = await admin
    .from("ledger_entries")
    .select("account, amount_pesewas, actor_user_id")
    .eq("account", "fb_revenue")
    .eq("actor_user_id", waiterUserId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ledgerErr || !ledgerRow) fail(`no fb_revenue ledger entry found: ${ledgerErr?.message}`);
  if (ledgerRow.amount_pesewas !== 8000) fail(`expected ledger fb_revenue amount 8000, got ${ledgerRow.amount_pesewas}`);

  results.push(
    "CHECK 3 PASS: Cash Received flips order to 'paid', creates a cash_movements row attributed to the confirming waiter, and an fb_revenue ledger entry for the order total",
  );
}

async function checkDoubleConfirmRejected(orderId: string, waiterToken: string) {
  const res = await fetch(new URL(`/api/v1/waiter/orders/${orderId}/cash-received`, platformUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${waiterToken}`, "content-type": "application/json" },
    body: JSON.stringify({ cashAmountPesewas: 8000 }),
  });
  if (res.status !== 409) fail(`expected 409 confirming cash on an already-paid order, got ${res.status}`);
  results.push("CHECK 4 PASS: confirming cash again on an already-paid order is rejected (409), not double-counted");
}

async function checkTableDetailNoLongerNeedsConfirmation(tableId: string, waiterToken: string, orderId: string) {
  const res = await fetch(new URL(`/api/v1/waiter/tables/${tableId}`, platformUrl), {
    headers: { authorization: `Bearer ${waiterToken}` },
  });
  if (!res.ok) fail(`GET table detail (post-confirm) HTTP ${res.status}`);
  const body = (await res.json()) as { orders: Array<{ id: string; status: string; needsCashConfirmation: boolean }> };
  const order = body.orders.find((o) => o.id === orderId);
  if (!order) fail("order disappeared from table detail after confirmation");
  if (order.status !== "paid") fail(`expected status 'paid', got '${order.status}'`);
  if (order.needsCashConfirmation) fail("expected needsCashConfirmation=false once the order is paid");
  results.push("CHECK 5 PASS: table detail reflects the order as paid with needsCashConfirmation=false");
}

async function main() {
  const { tableId, tableQrToken, menuItemId } = await ensureFixtures();
  const { userId: waiterUserId, token: waiterToken } = await createWaiterAndSignIn();

  const claimRes = await fetch(new URL(`/api/v1/waiter/tables/${tableId}/claim`, platformUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${waiterToken}` },
  });
  if (!claimRes.ok) fail(`claim setup failed: HTTP ${claimRes.status}`);

  const orderId = await createPendingCashOrder(tableQrToken, menuItemId);

  await checkTableDetailShowsPendingCash(tableId, waiterToken, orderId);
  await checkUnassignedWaiterForbidden(tableId, orderId);
  await checkCashReceivedConfirms(orderId, waiterToken, waiterUserId);
  await checkDoubleConfirmRejected(orderId, waiterToken);
  await checkTableDetailNoLongerNeedsConfirmation(tableId, waiterToken, orderId);

  for (const line of results) console.log(line);
  console.log("DAY 3 WAITER STEP 2 (table detail + Cash Received) GREEN");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
