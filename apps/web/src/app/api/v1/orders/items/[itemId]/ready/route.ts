export const runtime = "nodejs";

import { NextResponse } from "next/server";
import argon2 from "argon2";
import { createServiceClient } from "@/lib/supabase-service";
import { createPgClient } from "@/lib/pg-pool";

// Marks one order_item READY (Section 04: "There is one action on each
// item: a button labelled READY"). When every item on the order is
// ready/delivered, the order itself moves to 'ready' — the DB's existing
// enum value for the state spec's prose calls "SERVED".
//
// No payment confirmation here or anywhere on this path — this route
// only ever transitions an item that is already part of a paid order
// (order_items only exist once create_order_for_payment has run).

function parseDeviceAuth(header: string | null): { deviceId: string; apiKey: string } | null {
  if (!header) return null;
  const [scheme, rest] = header.split(" ");
  if (scheme !== "Device" || !rest) return null;
  const [deviceId, apiKey] = rest.split(".");
  if (!deviceId || !apiKey) return null;
  return { deviceId, apiKey };
}

export async function POST(request: Request, { params }: { params: { itemId: string } }) {
  const parsed = parseDeviceAuth(request.headers.get("authorization"));
  if (!parsed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: device, error } = await service
    .from("devices")
    .select("id, tenant_id, role, credential_hash, revoked_at")
    .eq("id", parsed.deviceId)
    .maybeSingle();

  if (error || !device || device.revoked_at) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (device.role !== "bar_display" && device.role !== "kitchen_display") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ok = await argon2.verify(device.credential_hash as string, parsed.apiKey);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pg = createPgClient();

  const { rows } = await pg.query(
    `UPDATE order_items SET status = 'ready'
     WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
     RETURNING order_id`,
    [params.itemId, device.tenant_id],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "item not found or already ready" }, { status: 404 });
  }

  const orderId = rows[0].order_id as string;

  const { rows: remaining } = await pg.query(
    `SELECT count(*)::int AS n FROM order_items WHERE order_id = $1 AND status NOT IN ('ready', 'delivered')`,
    [orderId],
  );

  const allReady = (remaining[0]?.n as number) === 0;
  if (allReady) {
    await pg.query(`UPDATE orders SET status = 'ready' WHERE id = $1 AND status = 'paid'`, [orderId]);
  }

  return NextResponse.json({ status: "ok", order_ready: allReady });
}
