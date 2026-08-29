export const runtime = "nodejs";

import { NextResponse } from "next/server";
import argon2 from "argon2";
import { createPostgresRedeemAdapter } from "@evolveit/shared";
import { createServiceClient } from "@/lib/supabase-service";
import { createPgClient, getPlatformAesKey } from "@/lib/pg-pool";

// Hub sync-push: replays offline admissions (apps/hub/src/sync.ts push())
// onto the cloud. Device-authenticated, hub role only.
//
// This does NOT call redeemTicket() / re-verify the TOTP code: the code
// was already correctly time-window-verified against the hub's local
// cache at the moment of the original scan, potentially minutes or hours
// before this replay runs while offline — re-checking it "now" would
// incorrectly reject a legitimate admission once its 30s window has long
// passed. Only the CAS/unique-constraint insert (adapter.tryRedeem) needs
// replaying, and it is still the one shared implementation from
// packages/shared/src/redeem-adapters/postgres.ts — never a raw UPDATE
// here (Appendix B #1, #8).

function parseDeviceAuth(header: string | null): { deviceId: string; apiKey: string } | null {
  if (!header) return null;
  const [scheme, rest] = header.split(" ");
  if (scheme !== "Device" || !rest) return null;
  const [deviceId, apiKey] = rest.split(".");
  if (!deviceId || !apiKey) return null;
  return { deviceId, apiKey };
}

interface PushRow {
  id: number;
  ticket_id: string;
  device_id: string | null;
  scanned_by: string | null;
  door_label: string | null;
  scanned_at: string;
}

export async function POST(request: Request) {
  const parsed = parseDeviceAuth(request.headers.get("authorization"));
  if (!parsed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: device, error } = await service
    .from("devices")
    .select("id, tenant_id, role, credential_hash, revoked_at")
    .eq("id", parsed.deviceId)
    .maybeSingle();

  if (error || !device || device.revoked_at) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (device.role !== "hub") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ok = await argon2.verify(device.credential_hash as string, parsed.apiKey);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { redemptions?: PushRow[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const rows = body.redemptions ?? [];
  const adapter = createPostgresRedeemAdapter(createPgClient(), getPlatformAesKey());

  const results: { id: number; outcome: "admitted" | "already_used" | "error" }[] = [];
  for (const row of rows) {
    if (!row.ticket_id || (!row.device_id && !device.id)) {
      results.push({ id: row.id, outcome: "error" });
      continue;
    }
    try {
      const result = await adapter.tryRedeem({
        ticketId: row.ticket_id,
        deviceId: row.device_id ?? device.id,
      });
      results.push({ id: row.id, outcome: result.admitted ? "admitted" : "already_used" });
    } catch {
      // Leave unsynced; the next 60s push cycle retries it.
      results.push({ id: row.id, outcome: "error" });
    }
  }

  return NextResponse.json({ results });
}
