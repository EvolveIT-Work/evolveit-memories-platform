export const runtime = "nodejs";

import { NextResponse } from "next/server";
import argon2 from "argon2";
import { createServiceClient } from "@/lib/supabase-service";

// Device-authenticated order queue for a bar/kitchen display (Section 04
// "Bar Display — What Bartenders See", Section 05). No hub event-stream
// exists yet — this is polled directly (spec's own documented fallback:
// "polling the cloud API every 4 seconds" when the hub is unreachable;
// used here as the primary mechanism since no event-stream layer exists
// to be primary over).
//
// Routing: a counter order (order.station_id set) shows only on the
// exact station device it belongs to (spec's bar-main / bar-vip are
// independent counters). A table order (order.table_id set, no
// station_id) has no specific counter — its items show on every display
// of the matching kind (all bar displays, all kitchen displays), since
// spec describes table routing generically ("drink items to the bar
// display, food items to the kitchen display").

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
  if (!parsed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data: device, error } = await service
    .from("devices")
    .select("id, tenant_id, role, credential_hash, revoked_at, station_id, stations(kind)")
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

  const stationKind = device.role === "bar_display" ? "bar" : "kitchen";

  // order_items for this kind, not yet delivered/complete, whose parent
  // order is paid — and either belongs to this device's own station
  // (counter order) or has no station at all (table order, shown on
  // every display of this kind).
  const { data: items, error: itemsErr } = await service
    .from("order_items")
    .select("id, name, qty, status, order_id, orders!inner(id, display_token, created_at, table_id, station_id, status, venue_tables(label))")
    .eq("tenant_id", device.tenant_id)
    .eq("station", stationKind)
    .in("status", ["pending", "ready"])
    .eq("orders.status", "paid")
    .order("created_at", { referencedTable: "orders", ascending: true });

  if (itemsErr) {
    return NextResponse.json({ error: "db error", detail: itemsErr.message }, { status: 500 });
  }

  type Row = {
    id: string;
    name: string;
    qty: number;
    status: string;
    order_id: string;
    orders: { id: string; display_token: string; created_at: string; table_id: string | null; station_id: string | null; status: string; venue_tables: { label: string } | null };
  };

  const filtered = (items as unknown as Row[]).filter((row) => {
    if (row.orders.station_id) {
      return row.orders.station_id === device.station_id;
    }
    return true; // table order — visible on every display of this kind
  });

  const orderMap = new Map<string, { orderId: string; displayToken: string; createdAt: string; tableLabel: string | null; items: { id: string; name: string; qty: number; status: string }[] }>();
  for (const row of filtered) {
    if (!orderMap.has(row.order_id)) {
      orderMap.set(row.order_id, {
        orderId: row.order_id,
        displayToken: row.orders.display_token,
        createdAt: row.orders.created_at,
        tableLabel: row.orders.venue_tables?.label ?? null,
        items: [],
      });
    }
    orderMap.get(row.order_id)!.items.push({ id: row.id, name: row.name, qty: row.qty, status: row.status });
  }

  return NextResponse.json({ orders: Array.from(orderMap.values()) });
}
