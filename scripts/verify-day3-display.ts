/**
 * Verifies Day 3 Step 4: the bar/kitchen display queue + ready flow
 * (/api/v1/orders/queue, /api/v1/orders/items/[id]/ready), using a real
 * paid order created via the real webhook — not a direct DB insert.
 *
 * Run: npx tsx scripts/verify-day3-display.ts
 */
import { createClient } from "@supabase/supabase-js";
import argon2 from "argon2";
import { randomBytes, createHmac } from "node:crypto";
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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const platformUrl = process.env.PLATFORM_PUBLIC_URL ?? "http://localhost:3000";
const paystackSecret = process.env.PAYSTACK_SECRET;

function fail(msg: string): never {
  for (const line of results) console.log(line);
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!url || !serviceKey) fail("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
if (!paystackSecret) {
  console.log("SKIP: PAYSTACK_SECRET not set — needed to create a real paid order to display");
  process.exit(0);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const results: string[] = [];

async function getFixtures() {
  let { data: table } = await admin.from("venue_tables").select("id").limit(1).maybeSingle();
  if (!table) {
    const { data: created, error } = await admin
      .from("venue_tables")
      .insert({ tenant_id: MEMORIES_TENANT_ID, label: "Verify Display Table", zone: "main", seating_capacity: 4, qr_token: `verify-display-table-${Date.now()}` })
      .select("id")
      .single();
    if (error || !created) fail(`venue_table insert failed: ${error?.message}`);
    table = created;
  }

  const stationCode = `verify-display-bar-${Date.now()}`;
  const { data: station, error: stationErr } = await admin
    .from("stations")
    .insert({ tenant_id: MEMORIES_TENANT_ID, code: stationCode, kind: "bar", label: "Verify Display Bar", qr_token: stationCode })
    .select("id")
    .single();
  if (stationErr || !station) fail(`station insert failed: ${stationErr?.message}`);

  const { data: menuItem, error: itemErr } = await admin
    .from("menu_items")
    .insert({ tenant_id: MEMORIES_TENANT_ID, name: "Verify Display Beer", station: "bar", price_pesewas: 2500, in_stock: true })
    .select("id")
    .single();
  if (itemErr || !menuItem) fail(`menu_item insert failed: ${itemErr?.message}`);

  const plaintext = `evd_${randomBytes(16).toString("hex")}`;
  const credential_hash = await argon2.hash(plaintext, { type: argon2.argon2id });
  const { data: device, error: deviceErr } = await admin
    .from("devices")
    .insert({ tenant_id: MEMORIES_TENANT_ID, role: "bar_display", label: "Verify Display Device", credential_hash, station_id: station!.id })
    .select("id")
    .single();
  if (deviceErr || !device) fail(`device insert failed: ${deviceErr?.message}`);

  return { tableId: table!.id as string, menuItemId: menuItem!.id as string, deviceId: device!.id as string, apiKey: plaintext };
}

async function createPaidOrder(tableId: string, menuItemId: string): Promise<string> {
  const reference = `verify-display-order-${Date.now()}`;
  const body = JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      amount: 2500,
      status: "success",
      metadata: {
        kind: "order",
        tenant_id: MEMORIES_TENANT_ID,
        table_id: tableId,
        customer_phone: "+233200000002",
        items: [{ menu_item_id: menuItemId, qty: 1 }],
      },
    },
  });
  const signature = createHmac("sha512", paystackSecret!).update(body).digest("hex");
  const res = await fetch(new URL("/api/paystack-webhook", platformUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": signature },
    body,
  });
  if (!res.ok) fail(`order webhook HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  return reference;
}

async function main() {
  const { tableId, menuItemId, deviceId, apiKey } = await getFixtures();
  const reference = await createPaidOrder(tableId, menuItemId);

  const authHeader = `Device ${deviceId}.${apiKey}`;

  const queueRes = await fetch(new URL("/api/v1/orders/queue", platformUrl), { headers: { authorization: authHeader } });
  if (!queueRes.ok) fail(`GET queue HTTP ${queueRes.status}: ${await queueRes.text().catch(() => "")}`);
  const queueBody = (await queueRes.json()) as { orders: Array<{ orderId: string; items: Array<{ id: string; status: string }> }> };

  const { rows } = await admin.from("orders").select("id").eq("local_ref", reference).single().then((r) => ({ rows: r.data ? [r.data] : [] }));
  if (rows.length !== 1) fail("could not find the order just created");
  const orderId = rows[0].id as string;

  const orderInQueue = queueBody.orders.find((o) => o.orderId === orderId);
  if (!orderInQueue) fail("newly paid order did not appear in the bar display queue");
  if (orderInQueue.items.length !== 1 || orderInQueue.items[0].status !== "pending") {
    fail(`expected exactly one pending item, got: ${JSON.stringify(orderInQueue.items)}`);
  }
  results.push("CHECK 1 PASS: a real paid order appears in the device-authenticated bar display queue");

  const itemId = orderInQueue.items[0].id;
  const readyRes = await fetch(new URL(`/api/v1/orders/items/${itemId}/ready`, platformUrl), {
    method: "POST",
    headers: { authorization: authHeader },
  });
  if (!readyRes.ok) fail(`POST ready HTTP ${readyRes.status}: ${await readyRes.text().catch(() => "")}`);
  const readyBody = await readyRes.json();
  if (readyBody.order_ready !== true) fail(`expected order_ready true (single-item order), got: ${JSON.stringify(readyBody)}`);
  results.push("CHECK 2 PASS: marking the only item READY flips the whole order to ready");

  const queueRes2 = await fetch(new URL("/api/v1/orders/queue", platformUrl), { headers: { authorization: authHeader } });
  const queueBody2 = (await queueRes2.json()) as { orders: Array<{ orderId: string }> };
  if (queueBody2.orders.some((o) => o.orderId === orderId)) {
    fail("order still appears in the queue after being marked fully ready — it should drop off");
  }
  results.push("CHECK 3 PASS: a fully-ready order disappears from the active queue on the next poll");

  for (const line of results) console.log(line);
  console.log("DAY 3 STEP 4 (bar/kitchen display queue + ready) GREEN");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
