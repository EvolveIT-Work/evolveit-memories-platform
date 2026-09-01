export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import { paystackInitialize, syntheticEmailFromPhone } from "@/lib/paystack";

// Initiates a Paystack payment for a counter or table order. Recomputes
// the total server-side from menu_items.price_pesewas before ever
// calling Paystack — the client-submitted cart is never trusted for
// price, same principle as create_order_for_payment re-validates it
// again at webhook time (defense in depth: this stops a customer from
// even reaching Paystack with a tampered amount; the DB function stops
// it from ever becoming an order if this check is somehow bypassed).
//
// No order/order_items are created here — only paystack-webhook does
// that, via create_order_for_payment, after Paystack confirms payment.

interface StartPaymentBody {
  context: "table" | "counter";
  token: string;
  items: Array<{ menu_item_id: string; qty: number }>;
  customer_phone: string;
}

export async function POST(request: Request) {
  let body: StartPaymentBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { context, token, items, customer_phone } = body;

  if (context !== "table" && context !== "counter") {
    return NextResponse.json({ error: "context must be 'table' or 'counter'" }, { status: 400 });
  }
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });
  if (!customer_phone || customer_phone.trim().length < 6) {
    return NextResponse.json({ error: "a valid phone number is required" }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "cart is empty" }, { status: 400 });
  }

  const service = createServiceClient();

  let tenantId: string;
  let tableId: string | null = null;
  let stationId: string | null = null;

  if (context === "table") {
    const { data: table, error } = await service
      .from("venue_tables")
      .select("id, tenant_id")
      .eq("qr_token", token)
      .maybeSingle();
    if (error || !table) return NextResponse.json({ error: "table not found" }, { status: 404 });
    tenantId = table.tenant_id as string;
    tableId = table.id as string;
  } else {
    const { data: station, error } = await service
      .from("stations")
      .select("id, tenant_id")
      .eq("code", token)
      .maybeSingle();
    if (error || !station) return NextResponse.json({ error: "station not found" }, { status: 404 });
    tenantId = station.tenant_id as string;
    stationId = station.id as string;
  }

  // Recompute the total from the DB, never from the client cart's price.
  const menuItemIds = items.map((i) => i.menu_item_id);
  const { data: menuItems, error: menuErr } = await service
    .from("menu_items")
    .select("id, price_pesewas, in_stock")
    .eq("tenant_id", tenantId)
    .in("id", menuItemIds);

  if (menuErr) return NextResponse.json({ error: "db error" }, { status: 500 });

  const menuById = new Map((menuItems ?? []).map((m) => [m.id as string, m]));
  let total = 0;
  for (const item of items) {
    const menuItem = menuById.get(item.menu_item_id);
    if (!menuItem) return NextResponse.json({ error: `menu item not found: ${item.menu_item_id}` }, { status: 400 });
    if (!menuItem.in_stock) return NextResponse.json({ error: `item out of stock: ${item.menu_item_id}` }, { status: 400 });
    if (!Number.isInteger(item.qty) || item.qty <= 0) {
      return NextResponse.json({ error: "invalid quantity" }, { status: 400 });
    }
    total += (menuItem.price_pesewas as number) * item.qty;
  }

  const platformUrl = process.env.PLATFORM_PUBLIC_URL ?? "http://localhost:3000";

  try {
    const { authorizationUrl, reference } = await paystackInitialize({
      email: syntheticEmailFromPhone(customer_phone),
      amountPesewas: total,
      callbackUrl: new URL(`/order/status`, platformUrl).toString(),
      metadata: {
        kind: "order",
        tenant_id: tenantId,
        table_id: tableId,
        station_id: stationId,
        customer_phone,
        items,
      },
    });

    return NextResponse.json({ authorization_url: authorizationUrl, reference });
  } catch (err) {
    return NextResponse.json({ error: "payment init failed", detail: String(err) }, { status: 502 });
  }
}
