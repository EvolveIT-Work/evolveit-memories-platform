/**
 * Creates Day-1 auth users, public.users rows, manager roles, and a hub device.
 * Requires SUPABASE_SERVICE_ROLE_KEY after you apply the SQL migration.
 */
import { createClient } from "@supabase/supabase-js";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { MEMORIES_TENANT_ID, TEST_VENUE_TENANT_ID } from "@evolveit/shared";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const memoriesEmail = process.env.DAY1_MANAGER_EMAIL ?? "manager@memories.test";
const memoriesPassword = process.env.DAY1_MANAGER_PASSWORD;
const testEmail = process.env.DAY1_TEST_MANAGER_EMAIL ?? "manager@testvenue.test";
const testPassword = process.env.DAY1_TEST_MANAGER_PASSWORD;

if (!memoriesPassword || !testPassword) {
  console.error("Set DAY1_MANAGER_PASSWORD and DAY1_TEST_MANAGER_PASSWORD (do not commit them).");
  process.exit(1);
}

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureUser(email: string, password: string, tenantId: string, displayName: string) {
  const { data: list } = await admin.auth.admin.listUsers();
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw created.error ?? new Error("createUser failed");
    }
    user = created.data.user;
  }

  const { error: upsertErr } = await admin.from("users").upsert(
    {
      id: user.id,
      tenant_id: tenantId,
      email,
      phone: null,
      display_name: displayName,
      token_version: 1,
    },
    { onConflict: "id" },
  );
  if (upsertErr) throw upsertErr;

  const { error: roleErr } = await admin.from("user_roles").upsert(
    {
      user_id: user.id,
      tenant_id: tenantId,
      role: "manager",
    },
    { onConflict: "user_id,tenant_id,role" },
  );
  if (roleErr) throw roleErr;

  return user.id;
}

async function ensureHubDevice() {
  const { data: existing } = await admin
    .from("devices")
    .select("id")
    .eq("tenant_id", MEMORIES_TENANT_ID)
    .eq("role", "hub")
    .is("revoked_at", null)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log("Hub device already exists:", existing[0].id);
    console.log("If you lost the api_key, revoke this device and re-run bootstrap.");
    return existing[0].id as string;
  }

  const apiKey = `evd_${randomBytes(32).toString("hex")}`;
  const credential_hash = await argon2.hash(apiKey, { type: argon2.argon2id });
  const { data, error } = await admin
    .from("devices")
    .insert({
      tenant_id: MEMORIES_TENANT_ID,
      role: "hub",
      label: "Venue Hub 1",
      credential_hash,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("device insert failed");
  console.log("HUB_DEVICE_ID=" + data.id);
  console.log("HUB_API_KEY=" + apiKey);
  return data.id as string;
}

async function main() {
  const memoriesUserId = await ensureUser(memoriesEmail, memoriesPassword, MEMORIES_TENANT_ID, "Memories Manager");
  const testUserId = await ensureUser(testEmail, testPassword, TEST_VENUE_TENANT_ID, "Test Venue Manager");
  await ensureHubDevice();
  console.log("memories_manager_user_id=" + memoriesUserId);
  console.log("test_manager_user_id=" + testUserId);
  console.log("Sign in at /staff/sign-in with", memoriesEmail);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
