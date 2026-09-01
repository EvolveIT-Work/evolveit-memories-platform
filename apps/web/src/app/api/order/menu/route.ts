export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";

// Resolves a scanned QR (table token or counter station code) to its
// target + the menu the customer should see. Section 04: counter menus
// show only that station's own items (kind='bar' station -> station='bar'
// items); table menus show everything, since "a waiter sees all items
// for their table" (both bar and kitchen items can go to one table).
// Out-of-stock items are excluded — "hidden in real time by management".

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const context = searchParams.get("context");
  const token = searchParams.get("token");

  if (context !== "table" && context !== "counter") {
    return NextResponse.json({ error: "context must be 'table' or 'counter'" }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }

  const service = createServiceClient();

  if (context === "table") {
    const { data: table, error } = await service
      .from("venue_tables")
      .select("id, tenant_id, label")
      .eq("qr_token", token)
      .maybeSingle();

    if (error || !table) {
      return NextResponse.json({ error: "table not found" }, { status: 404 });
    }

    const { data: items, error: itemsErr } = await service
      .from("menu_items")
      .select("id, name, station, price_pesewas")
      .eq("tenant_id", table.tenant_id)
      .eq("in_stock", true)
      .order("name");

    if (itemsErr) return NextResponse.json({ error: "db error" }, { status: 500 });

    return NextResponse.json({
      context: "table",
      targetId: table.id,
      targetLabel: table.label,
      items: items ?? [],
    });
  }

  // context === 'counter': per spec the QR encodes the station's own
  // human-readable code (e.g. ET1.bar-main), not a secret random token
  // like tables use — counter stations are meant to be printed/memorable,
  // not unguessable.
  const { data: station, error } = await service
    .from("stations")
    .select("id, tenant_id, kind, label")
    .eq("code", token)
    .maybeSingle();

  if (error || !station) {
    return NextResponse.json({ error: "station not found" }, { status: 404 });
  }

  const { data: items, error: itemsErr } = await service
    .from("menu_items")
    .select("id, name, station, price_pesewas")
    .eq("tenant_id", station.tenant_id)
    .eq("station", station.kind)
    .eq("in_stock", true)
    .order("name");

  if (itemsErr) return NextResponse.json({ error: "db error" }, { status: 500 });

  return NextResponse.json({
    context: "counter",
    targetId: station.id,
    targetLabel: station.label,
    items: items ?? [],
  });
}
