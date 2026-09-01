export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";

// Polled by /order/status while waiting for paystack-webhook to create
// the order. Payment confirmation is async and webhook-driven — the
// customer's browser redirecting back from Paystack does not itself
// create anything (same principle as ticket issuance: closing the
// browser right after paying still results in an order/ticket).

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const reference = searchParams.get("reference");
  const orderId = searchParams.get("order_id");
  if (!reference && !orderId) return NextResponse.json({ error: "missing reference or order_id" }, { status: 400 });

  const service = createServiceClient();
  const query = service.from("orders").select("id, status, display_token, amount_pesewas");
  const { data: order, error } = orderId
    ? await query.eq("id", orderId).maybeSingle()
    : await query.eq("local_ref", reference!).maybeSingle();

  if (error) return NextResponse.json({ error: "db error" }, { status: 500 });
  if (!order) return NextResponse.json({ status: "pending" });

  return NextResponse.json({
    status: order.status,
    display_token: order.display_token,
    amount_pesewas: order.amount_pesewas,
  });
}
