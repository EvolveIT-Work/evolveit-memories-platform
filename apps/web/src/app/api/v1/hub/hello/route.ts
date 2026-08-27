export const runtime = "nodejs";

import { NextResponse } from "next/server";
import argon2 from "argon2";
import type { DeviceRole, FeatureKey, HubTestSnapshot } from "@evolveit/shared";
import { createServiceClient } from "@/lib/supabase-service";

function parseDeviceAuth(header: string | null): { deviceId: string; apiKey: string } | null {
  if (!header) return null;
  const [scheme, rest] = header.split(" ");
  if (scheme !== "Device" || !rest) return null;
  const [deviceId, apiKey] = rest.split(".");
  if (!deviceId || !apiKey) return null;
  return { deviceId, apiKey };
}

export async function POST(request: Request) {
  const parsed = parseDeviceAuth(request.headers.get("authorization"));
  if (!parsed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: device, error } = await service
    .from("devices")
    .select("id, tenant_id, role, label, credential_hash, revoked_at")
    .eq("id", parsed.deviceId)
    .maybeSingle();

  if (error || !device) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (device.revoked_at) {
    return NextResponse.json({ error: "revoked" }, { status: 401 });
  }

  const ok = await argon2.verify(device.credential_hash as string, parsed.apiKey);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await service
    .from("devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", device.id);

  const { data: features } = await service
    .from("tenant_features")
    .select("feature_key, enabled")
    .eq("tenant_id", device.tenant_id);

  const { data: devices } = await service
    .from("devices")
    .select("id, role, label, revoked_at")
    .eq("tenant_id", device.tenant_id);

  const { count: ticketCount } = await service
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", device.tenant_id);

  const { count: revocationCount } = await service
    .from("revocations")
    .select("ticket_id", { count: "exact", head: true })
    .eq("tenant_id", device.tenant_id);

  const snapshot: HubTestSnapshot = {
    type: "test",
    tenant_id: device.tenant_id as string,
    generated_at: new Date().toISOString(),
    features: (features ?? []) as { feature_key: FeatureKey; enabled: boolean }[],
    devices: (devices ?? []).map((d) => ({
      id: d.id as string,
      role: d.role as DeviceRole,
      label: d.label as string,
      revoked: Boolean(d.revoked_at),
    })),
    ticket_count: ticketCount ?? 0,
    revocation_count: revocationCount ?? 0,
  };

  console.info(
    JSON.stringify({
      msg: "hub_hello",
      device_id: device.id,
      tenant_id: device.tenant_id,
      ticket_count: snapshot.ticket_count,
    }),
  );

  return NextResponse.json({ snapshot });
}
