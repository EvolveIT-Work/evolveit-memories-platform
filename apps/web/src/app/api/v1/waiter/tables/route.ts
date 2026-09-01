export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/staff-auth";
import { createPgClient } from "@/lib/pg-pool";

// Section 09 "Waiter Interface — Detailed Specification":
//   - "My Tables view: a list of tables assigned to this waiter for the
//     current shift. Each table shows how many active orders it has and
//     a colour indicator (grey = no orders, yellow = orders pending,
//     green = orders complete)."
//   - "All Tables view (manager-only): a live view of all tables across
//     the floor, their status, and the waiter assigned to each."
//
// One endpoint serves both: a plain 'waiter' gets their own assigned
// tables plus any currently-unassigned table (so there's a way to
// discover and claim a new table beyond scanning its QR code);
// 'manager'/'owner' gets the whole floor regardless of assignment.
// "Active" orders are anything not voided/complete (pending_pay, paid,
// ready); "pending" (yellow) is active orders not yet fully ready —
// this predates a 'delivered' order status, which does not exist yet.

export async function GET(request: Request) {
  const auth = await requireStaffSession(request, ["waiter", "manager", "owner"]);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const isManager = session.roles.includes("manager") || session.roles.includes("owner");

  const pg = createPgClient();

  const { rows } = await pg.query(
    `
    SELECT
      vt.id,
      vt.label,
      vt.zone,
      ta.waiter_user_id,
      wu.display_name AS waiter_name,
      count(o.id) FILTER (WHERE o.status NOT IN ('voided', 'complete')) AS active_order_count,
      count(o.id) FILTER (WHERE o.status NOT IN ('voided', 'complete', 'ready')) AS pending_order_count
    FROM venue_tables vt
    LEFT JOIN table_assignments ta ON ta.table_id = vt.id
    LEFT JOIN users wu ON wu.id = ta.waiter_user_id
    LEFT JOIN orders o ON o.table_id = vt.id
    WHERE vt.tenant_id = $1
    ${isManager ? "" : "AND (ta.waiter_user_id = $2 OR ta.waiter_user_id IS NULL)"}
    GROUP BY vt.id, vt.label, vt.zone, ta.waiter_user_id, wu.display_name
    ORDER BY vt.label ASC
    `,
    isManager ? [session.tenantId] : [session.tenantId, session.userId],
  );

  const tables = rows.map((r) => {
    const active = Number(r.active_order_count);
    const pending = Number(r.pending_order_count);
    const status: "grey" | "yellow" | "green" = active === 0 ? "grey" : pending > 0 ? "yellow" : "green";
    return {
      id: r.id as string,
      label: r.label as string,
      zone: r.zone as string,
      waiterUserId: (r.waiter_user_id as string | null) ?? null,
      waiterName: (r.waiter_name as string | null) ?? null,
      activeOrderCount: active,
      status,
    };
  });

  return NextResponse.json({ tables, scope: isManager ? "all" : "mine" });
}
