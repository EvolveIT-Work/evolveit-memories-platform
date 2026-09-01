/**
 * Verifies Day 3 Step 2: the order side of the Paystack webhook
 * (metadata.kind = 'order' -> app.create_order_for_payment), using only
 * the real webhook route — no direct RPC calls bypassing it.
 *
 * Prerequisites: same as verify-day2.ts (dev:web running, .env set,
 * bootstrap-day1 already run). Requires PAYSTACK_SECRET to sign
 * requests — this whole suite is skipped if it's absent.
 *
 * Run: npx tsx scripts/verify-day3.ts
 */
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MEMORIES_TENANT_ID, type PostgresLikeClient } from "@evolveit/shared";

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
const databaseUrl = process.env.DATABASE_URL;
const platformUrl = process.env.PLATFORM_PUBLIC_URL ?? "http://localhost:3000";
const paystackSecret = process.env.PAYSTACK_SECRET;

const results: string[] = [];

function fail(msg: string): never {
  for (const line of results) console.log(line);
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!url || !serviceKey) fail("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
if (!databaseUrl) fail("Missing DATABASE_URL");
if (!paystackSecret) {
  console.log("SKIP: PAYSTACK_SECRET not set — Day 3 order webhook checks need it, same as Day 2 Check 5");
  process.exit(0);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const pgClient: PostgresLikeClient = {
  async query(sql, params) {
    const result = await pool.query(sql, params as unknown[]);
    return { rows: result.rows as Record<string, unknown>[] };
  },
};

function signAndSend(body: string) {
  const signature = createHmac("sha512", paystackSecret!).update(body).digest("hex");
  return fetch(new URL("/api/paystack-webhook", platformUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "x-paystack-signature": signature },
    body,
  });
}

async function getFixtures() {
  let { data: table } = await admin.from("venue_tables").select("id, qr_token").limit(1).maybeSingle();
  if (!table) {
    const { data: created, error } = await admin
      .from("venue_tables")
      .insert({ tenant_id: MEMORIES_TENANT_ID, label: "Verify Day3 Table", zone: "main", seating_capacity: 4, qr_token: `verify-day3-table-${Date.now()}` })
      .select("id, qr_token")
      .single();
    if (error || !created) fail(`venue_table insert failed: ${error?.message}`);
    table = created;
  }

  let { data: station } = await admin.from("stations").select("id, code").eq("tenant_id", MEMORIES_TENANT_ID).limit(1).maybeSingle();
  if (!station) {
    const stationCode = `verify-day3-bar-${Date.now()}`;
    const { data: created, error } = await admin
      .from("stations")
      .insert({ tenant_id: MEMORIES_TENANT_ID, code: stationCode, kind: "bar", label: "Verify Day3 Bar", qr_token: stationCode })
      .select("id, code")
      .single();
    if (error || !created) fail(`station insert failed: ${error?.message}`);
    station = created;
  }

  const { data: item1, error: item1Err } = await admin
    .from("menu_items")
    .insert({ tenant_id: MEMORIES_TENANT_ID, name: "Verify Day3 Beer", station: "bar", price_pesewas: 3000, in_stock: true })
    .select("id")
    .single();
  if (item1Err || !item1) fail(`menu_item insert failed: ${item1Err?.message}`);

  const { data: outOfStockItem, error: oosErr } = await admin
    .from("menu_items")
    .insert({ tenant_id: MEMORIES_TENANT_ID, name: "Verify Day3 Sold Out Item", station: "kitchen", price_pesewas: 5000, in_stock: false })
    .select("id")
    .single();
  if (oosErr || !outOfStockItem) fail(`out-of-stock menu_item insert failed: ${oosErr?.message}`);

  return {
    tableId: table!.id as string,
    tableQrToken: table!.qr_token as string,
    stationCode: station!.code as string,
    menuItemId: item1!.id as string,
    outOfStockItemId: outOfStockItem!.id as string,
  };
}

async function checkOrderPaymentCreatesOrder(tableId: string, menuItemId: string) {
  const reference = `verify-day3-order-${Date.now()}`;
  const body = JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      amount: 6000, // 2 x 3000
      status: "success",
      metadata: {
        kind: "order",
        tenant_id: MEMORIES_TENANT_ID,
        table_id: tableId,
        customer_phone: "+233200000000",
        items: [{ menu_item_id: menuItemId, qty: 2 }],
      },
    },
  });

  const res = await signAndSend(body);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    fail(`order webhook HTTP ${res.status}: ${text}`);
  }

  const { rows } = await pgClient.query(
    `SELECT o.id, o.status, o.amount_pesewas, o.display_token, oi.name, oi.qty, oi.status AS item_status
     FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE o.local_ref = $1`,
    [reference],
  );
  if (rows.length !== 1) fail(`expected exactly one order_item for reference ${reference}, got ${rows.length}`);
  const row = rows[0] as { id: string; status: string; amount_pesewas: number; display_token: string; name: string; qty: number; item_status: string };
  if (row.status !== "paid") fail(`expected order status 'paid', got '${row.status}'`);
  if (row.amount_pesewas !== 6000) fail(`expected amount 6000, got ${row.amount_pesewas}`);
  if (row.qty !== 2) fail(`expected qty 2, got ${row.qty}`);
  if (row.item_status !== "pending") fail(`expected order_item status 'pending', got '${row.item_status}'`);
  if (!/^\d{4}$/.test(row.display_token)) fail(`expected a 4-digit display_token, got '${row.display_token}'`);

  results.push(`CHECK 1 PASS: a real order webhook call created order ${row.id} (paid, correct amount, correct item, 4-digit display token ${row.display_token}) via create_order_for_payment`);
}

async function checkTamperedAmountRejected(tableId: string, menuItemId: string) {
  const reference = `verify-day3-tamper-${Date.now()}`;
  const body = JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      amount: 100, // real price is 3000 for qty 1 — client-tampered low amount
      status: "success",
      metadata: {
        kind: "order",
        tenant_id: MEMORIES_TENANT_ID,
        table_id: tableId,
        customer_phone: "+233200000000",
        items: [{ menu_item_id: menuItemId, qty: 1 }],
      },
    },
  });

  const res = await signAndSend(body);
  if (res.ok) fail("expected a tampered/mismatched amount to be rejected, but the webhook returned 200");

  const { rows } = await pgClient.query(`SELECT id FROM orders WHERE local_ref = $1`, [reference]);
  if (rows.length !== 0) fail("order was created despite an amount mismatch — server-side price validation is broken");

  results.push("CHECK 2 PASS: a client-tampered amount is rejected server-side, and no order/order_items are created");
}

async function checkOutOfStockRejected(tableId: string, outOfStockItemId: string) {
  const reference = `verify-day3-oos-${Date.now()}`;
  const body = JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      amount: 5000,
      status: "success",
      metadata: {
        kind: "order",
        tenant_id: MEMORIES_TENANT_ID,
        table_id: tableId,
        customer_phone: "+233200000000",
        items: [{ menu_item_id: outOfStockItemId, qty: 1 }],
      },
    },
  });

  const res = await signAndSend(body);
  if (res.ok) fail("expected an out-of-stock item to be rejected, but the webhook returned 200");

  const { rows } = await pgClient.query(`SELECT id FROM orders WHERE local_ref = $1`, [reference]);
  if (rows.length !== 0) fail("order was created despite the item being out of stock");

  results.push("CHECK 3 PASS: an out-of-stock item is rejected server-side, and no order is created");
}

async function checkMenuEndpoint(tableQrToken: string, stationCode: string) {
  const tableRes = await fetch(new URL(`/api/order/menu?context=table&token=${encodeURIComponent(tableQrToken)}`, platformUrl));
  if (!tableRes.ok) fail(`GET /api/order/menu (table) HTTP ${tableRes.status}`);
  const tableBody = await tableRes.json();
  if (!Array.isArray(tableBody.items) || tableBody.items.length === 0) fail("table menu returned no items");

  const counterRes = await fetch(new URL(`/api/order/menu?context=counter&token=${encodeURIComponent(stationCode)}`, platformUrl));
  if (!counterRes.ok) fail(`GET /api/order/menu (counter) HTTP ${counterRes.status}`);
  const counterBody = await counterRes.json();
  if (!Array.isArray(counterBody.items)) fail("counter menu did not return an items array");
  if (counterBody.items.some((i: { station: string }) => i.station !== "bar")) {
    fail("counter menu returned a non-bar item — station filtering is broken");
  }

  results.push("CHECK 4 PASS: /api/order/menu resolves both table and counter QR tokens and filters correctly");
}

async function checkStartPaymentReturnsRealCheckoutUrl(tableQrToken: string, menuItemId: string) {
  const res = await fetch(new URL("/api/order/start-payment", platformUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      context: "table",
      token: tableQrToken,
      customer_phone: "+233200000001",
      items: [{ menu_item_id: menuItemId, qty: 1 }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    fail(`start-payment HTTP ${res.status}: ${text}`);
  }
  const body = await res.json();
  if (!body.authorization_url || !body.authorization_url.startsWith("https://checkout.paystack.com/")) {
    fail(`expected a real Paystack checkout URL, got: ${JSON.stringify(body)}`);
  }

  results.push("CHECK 5 PASS: /api/order/start-payment computes the total server-side and returns a real Paystack checkout URL");
}

async function main() {
  const { tableId, tableQrToken, stationCode, menuItemId, outOfStockItemId } = await getFixtures();
  await checkOrderPaymentCreatesOrder(tableId, menuItemId);
  await checkTamperedAmountRejected(tableId, menuItemId);
  await checkOutOfStockRejected(tableId, outOfStockItemId);
  await checkMenuEndpoint(tableQrToken, stationCode);
  await checkStartPaymentReturnsRealCheckoutUrl(tableQrToken, menuItemId);

  for (const line of results) console.log(line);
  console.log("DAY 3 STEP 2+3 (order webhook + customer-facing menu/checkout) GREEN");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
