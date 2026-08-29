export const runtime = "nodejs";

import { NextResponse } from "next/server";
import argon2 from "argon2";
import { decryptTotpSecret } from "@evolveit/shared";
import { createServiceClient } from "@/lib/supabase-service";
import { getPlatformAesKey } from "@/lib/pg-pool";

// Hub sync-pull (Section 10 "revocations": hub downloads on shift start and
// every 60s; apps/hub/src/sync.ts polls this every 60s). Device-authenticated,
// hub role only — this is not the door scanner's endpoint.
//
// Prohibition #6 ("never include totp_secret... in API responses") is aimed
// at unauthorized exposure (customer-facing responses, logs, error text).
// The hub is the one other party (besides the ticket holder's own browser
// via live-ticket-session) that legitimately needs the raw secret to do
// offline TOTP verification (Appendix A: hub as primary scan coordinator,
// door must not go dark). We decrypt it here, once, server-side, and send
// it only over this device-authenticated channel — never logged.

function parseDeviceAuth(header: string | null): { deviceId: string; apiKey: string } | null {
  if (!header) return null;
  const [scheme, rest] = header.split(" ");
  if (scheme !== "Device" || !rest) return null;
  const [deviceId, apiKey] = rest.split(".");
  if (!deviceId || !apiKey) return null;
  return { deviceId, apiKey };
}

export async function GET(request: Request) {
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
    // sync-pull is the hub's endpoint only; door scanners talk to the hub
    // over LAN, never directly to this route.
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ok = await argon2.verify(device.credential_hash as string, parsed.apiKey);
  if (!ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await service.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);

  // Only issued/used tickets: voided tickets are handled exclusively via
  // the revocations feed below (Section 10), not through this list.
  const { data: tickets, error: ticketsErr } = await service
    .from("tickets")
    .select("id, event_id, status, totp_secret_enc, users(display_name), ticket_types(name)")
    .eq("tenant_id", device.tenant_id)
    .in("status", ["issued", "used"]);

  if (ticketsErr) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const { data: revocations, error: revErr } = await service
    .from("revocations")
    .select("ticket_id")
    .eq("tenant_id", device.tenant_id);

  if (revErr) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const { data: devices, error: devicesErr } = await service
    .from("devices")
    .select("id, tenant_id, role, label, credential_hash, event_ids, revoked_at")
    .eq("tenant_id", device.tenant_id);

  if (devicesErr) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const key = getPlatformAesKey();
  type TicketRow = {
    id: string;
    event_id: string;
    status: string;
    totp_secret_enc: string | null;
    users: { display_name: string } | null;
    ticket_types: { name: string } | null;
  };

  const ticketsOut = (tickets as unknown as TicketRow[] ?? [])
    .map((t) => {
      if (!t.totp_secret_enc) return null;
      let secretB64: string;
      try {
        secretB64 = decryptTotpSecret(Buffer.from(t.totp_secret_enc, "base64"), key).toString("base64");
      } catch {
        // Fails closed: a ticket whose secret can't be decrypted is
        // omitted from the sync set rather than sent as ciphertext.
        return null;
      }
      return {
        id: t.id,
        event_id: t.event_id,
        status: t.status,
        holder_name: t.users?.display_name ?? "",
        ticket_type: t.ticket_types?.name ?? "",
        totp_secret: secretB64,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return NextResponse.json({
    tickets: ticketsOut,
    revocations: (revocations ?? []).map((r) => ({ ticket_id: r.ticket_id })),
    devices: (devices ?? []).map((d) => ({
      id: d.id,
      tenant_id: d.tenant_id,
      role: d.role,
      label: d.label,
      credential_hash: d.credential_hash,
      event_ids: d.event_ids ?? [],
      revoked: Boolean(d.revoked_at),
    })),
  });
}
