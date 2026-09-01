export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/staff-auth";
import { createServiceClient } from "@/lib/supabase-service";
import { createPgClient } from "@/lib/pg-pool";

// Section 09 "Table detail: all orders for the table in chronological
// order. Each order shows items, their status (pending, preparing,
// ready, delivered), and the payment method (QR/MoMo shown
// automatically; Cash Received button for cash collection)."
//
// order_items/orders don't have a 'delivered' status yet (only
// pending/ready at the item level, pending_pay/paid/ready/complete/
// voided at the order level) — surfaced as-is; 'delivered' is a known
// Day 3 gap (README), not invented here at the API layer.

export async function GET(request: Request, { params }: { params: { tableId: string } }) {
  const auth = await requireStaffSession(request, ["waiter", "manager", "owner"]);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const isManager = session.roles.includes("manager") || session.roles.includes("owner");

  const service = createServiceClient();
  const { data: table, error: tableErr } = await service
    .from("venue_tables")
    .select("id, label, zone")
    .eq("id", params.tableId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (tableErr || !table) return NextResponse.json({ error: "table not found" }, { status: 404 });

  const pg = createPgClient();

  if (!isManager) {
    const { rows: assignmentRows } = await pg.query(
      `SELECT 1 FROM table_assignments WHERE table_id = $1 AND waiter_user_id = $2`,
      [params.tableId, session.userId],
    );
    if (assignmentRows.length === 0) {
      return NextResponse.json({ error: "table not assigned to you" }, { status: 403 });
    }
  }

  const { rows } = await pg.query(
    `
    SELECT
      o.id AS order_id, o.display_token, o.payment_source, o.status, o.amount_pesewas, o.created_at,
      oi.id AS item_id, oi.name, oi.qty, oi.status AS item_status
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.table_id = $1
    ORDER BY o.created_at ASC, oi.id ASC
    `,
    [params.tableId],
  );

  type Row = {
    order_id: string;
    display_token: string;
    payment_source: string;
    status: string;
    amount_pesewas: number;
    created_at: string;
    item_id: string | null;
    name: string | null;
    qty: number | null;
    item_status: string | null;
  };

  interface OrderView {
    id: string;
    displayToken: string;
    paymentSource: string;
    status: string;
    amountPesewas: number;
    createdAt: string;
    needsCashConfirmation: boolean;
    items: { id: string; name: string; qty: number; status: string }[];
  }

  const orderMap = new Map<string, OrderView>();
  for (const r of rows as unknown as Row[]) {
    if (!orderMap.has(r.order_id)) {
      orderMap.set(r.order_id, {
        id: r.order_id,
        displayToken: r.display_token,
        paymentSource: r.payment_source,
        status: r.status,
        amountPesewas: r.amount_pesewas,
        createdAt: r.created_at,
        needsCashConfirmation: r.payment_source === "cash" && r.status === "pending_pay",
        items: [],
      });
    }
    if (r.item_id) {
      orderMap.get(r.order_id)!.items.push({
        id: r.item_id,
        name: r.name as string,
        qty: r.qty as number,
        status: r.item_status as string,
      });
    }
  }

  return NextResponse.json({
    table: { id: table.id as string, label: table.label as string, zone: table.zone as string },
    orders: Array.from(orderMap.values()),
  });
}
