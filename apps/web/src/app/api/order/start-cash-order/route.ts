export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";

// Table-only cash checkout (Section 04, Reading B — confirmed with the
// venue): creates the order held at 'pending_pay' via
// app.create_cash_order — invisible to bar/kitchen displays until the
// assigned waiter confirms with Cash Received (see
// /api/v1/waiter/orders/[orderId]/cash-received). No Paystack call here
// at all; this is synchronous, unlike start-payment.

interface StartCashOrderBody {
  token: string; // table qr_token — cash is table-only, never counter
  items: Array<{ menu_item_id: string; qty: number }>;
  customer_phone: string;
}

export async function POST(request: Request) {
  let body: StartCashOrderBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { token, items, customer_phone } = body;
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });
  if (!customer_phone || customer_phone.trim().length < 6) {
    return NextResponse.json({ error: "a valid phone number is required" }, { status: 400 });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "cart is empty" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: table, error: tableErr } = await service
    .from("venue_tables")
    .select("id, tenant_id")
    .eq("qr_token", token)
    .maybeSingle();
  if (tableErr || !table) return NextResponse.json({ error: "table not found" }, { status: 404 });

  const cashResp = await service.schema("app").rpc("create_cash_order", {
    p_tenant_id: table.tenant_id,
    p_table_id: table.id,
    p_customer_phone: customer_phone,
    p_items: items,
  });

  if (cashResp.error) {
    return NextResponse.json({ error: "order creation failed", detail: cashResp.error.message }, { status: 400 });
  }

  const row = (cashResp.data as Array<{ order_id: string; display_token: string; amount_pesewas: number }> | null)?.[0];
  if (!row) return NextResponse.json({ error: "order creation failed" }, { status: 500 });

  // No Paystack reference exists for cash — the order's own id doubles
  // as the polling key /order/status uses.
  return NextResponse.json({ order_id: row.order_id, display_token: row.display_token, amount_pesewas: row.amount_pesewas });
}
