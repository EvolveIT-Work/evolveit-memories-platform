export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/staff-auth";
import { createServiceClient } from "@/lib/supabase-service";
import { createPgClient } from "@/lib/pg-pool";
import { getOrOpenShift } from "@/lib/shifts";

// Section 04 "Table Cash Payment": "The waiter's interface includes a
// Cash Received button on any table order. When tapped, the waiter
// enters the cash amount received, and the system records: the order
// ID, the amount, the waiter ID, and the timestamp." Backed by
// app.confirm_cash_order_payment (0024_cash_order_functions) — this
// route is the auth + shift-resolution wrapper around it; the function
// itself re-checks payment_source/status under a row lock (FOR UPDATE),
// so the checks here are a fast-fail for a clear error message, not the
// only guard against a stale double-submit.
//
// "No manager PIN is required for a waiter to mark a cash payment"
// (Section 04) — accountability is attribution, not approval. The
// waiter id recorded is always session.userId from the verified staff
// session, never a client-supplied field, so a waiter cannot attribute
// their cash to someone else.

interface CashReceivedBody {
  cashAmountPesewas?: number;
}

export async function POST(request: Request, { params }: { params: { orderId: string } }) {
  const auth = await requireStaffSession(request, ["waiter", "manager", "owner"]);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const isManager = session.roles.includes("manager") || session.roles.includes("owner");

  let body: CashReceivedBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const cashAmountPesewas = body.cashAmountPesewas;
  if (!Number.isInteger(cashAmountPesewas) || (cashAmountPesewas as number) <= 0) {
    return NextResponse.json({ error: "cashAmountPesewas must be a positive integer" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: order, error: orderErr } = await service
    .from("orders")
    .select("id, tenant_id, table_id, payment_source, status")
    .eq("id", params.orderId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (orderErr || !order) return NextResponse.json({ error: "order not found" }, { status: 404 });
  if (order.payment_source !== "cash") {
    return NextResponse.json({ error: "not a cash order" }, { status: 400 });
  }
  if (order.status !== "pending_pay") {
    return NextResponse.json({ error: `order is not pending payment (status=${order.status})` }, { status: 409 });
  }

  const pg = createPgClient();

  if (!isManager) {
    const { rows: assignmentRows } = await pg.query(
      `SELECT 1 FROM table_assignments WHERE table_id = $1 AND waiter_user_id = $2`,
      [order.table_id, session.userId],
    );
    if (assignmentRows.length === 0) {
      return NextResponse.json({ error: "table not assigned to you" }, { status: 403 });
    }
  }

  const shiftId = await getOrOpenShift(pg, session.tenantId, session.userId);

  const { error: rpcErr } = await service.schema("app").rpc("confirm_cash_order_payment", {
    p_tenant_id: session.tenantId,
    p_order_id: params.orderId,
    p_waiter_user_id: session.userId,
    p_shift_id: shiftId,
    p_cash_amount_pesewas: cashAmountPesewas,
  });

  if (rpcErr) {
    return NextResponse.json({ error: "cash confirmation failed", detail: rpcErr.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok", orderId: params.orderId, shiftId, cashAmountPesewas });
}
