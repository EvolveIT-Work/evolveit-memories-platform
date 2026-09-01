import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";

// Shared staff-session auth for /api/v1/waiter/* (and future /api/v1/*
// staff routes — kitchen, cashier, manager reports). This is deliberately
// separate from the device-auth helper used by bar/kitchen display routes
// (apps/web/src/app/api/v1/orders/*): those are unattended devices with an
// argon2 API key; this is a human staff member's own Supabase identity.
//
// Section 09 describes the waiter PWA as "installed on the waiter's own
// phone or a provided device" — not guaranteed to share cookies with the
// /staff Next.js session, so this accepts either:
//   - Authorization: Bearer <supabase access token> (used by the verify
//     scripts, and any installed PWA keeping its own session), or
//   - the cookie-based Supabase session (used by in-browser /staff and
//     /order/waiter pages).
//
// Role and tenant are always re-read from public.users / public.user_roles
// via the service client — never trusted from the token/session alone —
// matching the "verify device row, don't trust the header" pattern in the
// device-auth routes.

export interface StaffSession {
  userId: string;
  tenantId: string;
  roles: string[];
}

export type StaffAuthResult = { ok: true; session: StaffSession } | { ok: false; response: NextResponse };

async function resolveUserId(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    return data.user.id;
  }

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function requireStaffSession(request: Request, allowedRoles: string[]): Promise<StaffAuthResult> {
  const userId = await resolveUserId(request);
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const service = createServiceClient();
  const { data: profile, error: profileErr } = await service
    .from("users")
    .select("id, tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr || !profile) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: roleRows, error: roleErr } = await service
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", profile.tenant_id);

  if (roleErr) {
    return { ok: false, response: NextResponse.json({ error: "db error", detail: roleErr.message }, { status: 500 }) };
  }

  const roles = (roleRows ?? []).map((r) => r.role as string);
  if (!roles.some((r) => allowedRoles.includes(r))) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { ok: true, session: { userId, tenantId: profile.tenant_id as string, roles } };
}
