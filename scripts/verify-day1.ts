/**
 * Four Day-1 acceptance checks (Section 12):
 * 1. Schema + FORCE RLS + ledger immutability
 * 2. Manager can sign in
 * 3. RLS blocks cross-tenant reads
 * 4. Hub hello returns a test snapshot
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const platform = process.env.PLATFORM_PUBLIC_URL ?? "http://localhost:3000";
const memoriesEmail = process.env.DAY1_MANAGER_EMAIL ?? "manager@memories.test";
const memoriesPassword = process.env.DAY1_MANAGER_PASSWORD;
const testEmail = process.env.DAY1_TEST_MANAGER_EMAIL ?? "manager@testvenue.test";
const testPassword = process.env.DAY1_TEST_MANAGER_PASSWORD;
const hubDeviceId = process.env.HUB_DEVICE_ID;
const hubApiKey = process.env.HUB_API_KEY;

function fail(msg: string): never {
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!url || !anon || !service) fail("Missing NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE");
if (!memoriesPassword || !testPassword) fail("Missing DAY1_MANAGER_PASSWORD / DAY1_TEST_MANAGER_PASSWORD");

const admin = createClient(url, service, { auth: { persistSession: false } });
const results: string[] = [];

async function checkSchema() {
  const tables = [
    "tenants",
    "tenant_features",
    "users",
    "user_roles",
    "devices",
    "shifts",
    "events",
    "ticket_types",
    "tickets",
    "ticket_redemptions",
    "ticket_payments",
    "ownership_history",
    "revocations",
    "webhook_events",
    "ledger_entries",
    "payments",
    "venue_tables",
    "table_reservations",
    "orders",
    "order_items",
    "cash_movements",
    "settlement_statements",
  ];

  for (const table of tables) {
    const { error: tErr } = await admin.from(table).select("*").limit(0);
    if (tErr) fail(`schema: missing or unreadable table ${table}: ${tErr.message}`);
  }

  const { data: forced, error: forceErr } = await admin.rpc("day1_force_rls_ok");
  if (forceErr) fail(`FORCE RLS probe failed: ${forceErr.message}`);
  if (forced !== true) fail("FORCE RLS is not enabled on all tenant tables (Section 10)");

  const { error: mutErr } = await admin
    .from("ledger_entries")
    .update({ amount_pesewas: 1 })
    .eq("id", "00000000-0000-0000-0000-000000000000");
  if (mutErr && /immutable/i.test(mutErr.message)) {
    results.push("CHECK 1 PASS: tables exist; ledger UPDATE blocked by trigger");
    return;
  }

  const { data: inserted, error: insErr } = await admin
    .from("ledger_entries")
    .insert({
      tenant_id: "11111111-1111-1111-1111-111111111111",
      account: "ticket_revenue",
      amount_pesewas: 150,
    })
    .select("id")
    .single();
  if (insErr || !inserted) fail(`ledger insert for trigger test failed: ${insErr?.message}`);

  const { error: updErr } = await admin
    .from("ledger_entries")
    .update({ amount_pesewas: 1 })
    .eq("id", inserted.id);
  if (!updErr || !/immutable/i.test(updErr.message)) {
    fail(`ledger UPDATE was not blocked (Appendix B #4). Got: ${updErr?.message ?? "no error"}`);
  }

  const { error: delErr } = await admin.from("ledger_entries").delete().eq("id", inserted.id);
  if (!delErr || !/immutable/i.test(delErr.message)) {
    fail(`ledger DELETE was not blocked (Appendix B #4). Got: ${delErr?.message ?? "no error"}`);
  }

  results.push("CHECK 1 PASS: schema readable; FORCE RLS assumed (migration); ledger immutable");
}

async function checkManagerSignIn() {
  const mem = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await mem.auth.signInWithPassword({
    email: memoriesEmail,
    password: memoriesPassword,
  });
  if (error || !data.user) fail(`manager sign-in failed: ${error?.message}`);
  const { data: profile, error: pErr } = await mem
    .from("users")
    .select("tenant_id, display_name")
    .eq("id", data.user.id)
    .single();
  if (pErr || !profile) fail(`manager profile RLS/read failed: ${pErr?.message}`);
  results.push(`CHECK 2 PASS: manager signed in as ${profile.display_name}`);
  return mem;
}

async function checkCrossTenant(memoriesClient: ReturnType<typeof createClient>) {
  const test = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await test.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (error) fail(`test manager sign-in failed: ${error.message}`);

  const { data: otherTenants, error: tErr } = await memoriesClient.from("tenants").select("slug");
  if (tErr) fail(tErr.message);
  const slugs = (otherTenants ?? []).map((t) => t.slug);
  if (slugs.includes("evolveit-test-venue")) {
    fail("RLS leak: Memories manager can read the test tenant row");
  }
  if (!slugs.includes("memories-cape-coast")) {
    fail("Memories manager cannot read own tenant");
  }

  const { data: features } = await memoriesClient.from("tenant_features").select("tenant_id");
  const tenantIds = new Set((features ?? []).map((f) => f.tenant_id));
  if (tenantIds.has("22222222-2222-2222-2222-222222222222")) {
    fail("RLS leak: Memories manager can read test venue feature flags");
  }

  results.push("CHECK 3 PASS: RLS blocks cross-tenant reads");
}

async function checkHubHello() {
  if (!hubDeviceId || !hubApiKey) fail("Set HUB_DEVICE_ID and HUB_API_KEY from bootstrap output");
  const res = await fetch(`${platform}/api/v1/hub/hello`, {
    method: "POST",
    headers: { authorization: `Device ${hubDeviceId}.${hubApiKey}` },
  });
  if (!res.ok) fail(`hub hello HTTP ${res.status} — is the web app running at ${platform}?`);
  const body = (await res.json()) as { snapshot?: { type?: string; tenant_id?: string } };
  if (body.snapshot?.type !== "test" || !body.snapshot.tenant_id) {
    fail("hub hello did not return a test snapshot");
  }
  results.push(`CHECK 4 PASS: hub received test snapshot for tenant ${body.snapshot.tenant_id}`);
}

async function main() {
  await checkSchema();
  const memoriesClient = await checkManagerSignIn();
  await checkCrossTenant(memoriesClient);
  await checkHubHello();
  for (const line of results) console.log(line);
  console.log("DAY 1 GREEN");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
