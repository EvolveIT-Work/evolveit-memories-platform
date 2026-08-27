export const runtime = "nodejs";

import { NextResponse } from "next/server";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase-service";
import type { DeviceRole } from "@evolveit/shared";

const DEVICE_ROLES: DeviceRole[] = ["hub", "door", "bar_display", "kitchen_display"];

export async function POST(request: Request) {
  const userClient = createServerSupabase();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: roles } = await userClient.from("user_roles").select("role, tenant_id").eq("user_id", user.id);
  const allowed = (roles ?? []).filter((r) => r.role === "manager" || r.role === "owner");
  if (allowed.length === 0) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { role?: string; label?: string };
  if (!body.role || !DEVICE_ROLES.includes(body.role as DeviceRole) || !body.label) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const tenantId = allowed[0].tenant_id as string;
  const plaintext = `evd_${randomBytes(32).toString("hex")}`;
  const credential_hash = await argon2.hash(plaintext, { type: argon2.argon2id });

  const service = createServiceClient();
  const { data, error } = await service
    .from("devices")
    .insert({
      tenant_id: tenantId,
      role: body.role,
      label: body.label,
      credential_hash,
    })
    .select("id, tenant_id, role, label")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "register_failed" }, { status: 500 });
  }

  return NextResponse.json({
    device: data,
    api_key: plaintext,
    warning: "Store this api_key on the device. It is not shown again.",
  });
}
