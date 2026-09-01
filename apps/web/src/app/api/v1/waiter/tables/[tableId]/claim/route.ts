export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/staff-auth";
import { createServiceClient } from "@/lib/supabase-service";
import { createPgClient } from "@/lib/pg-pool";

// 0023_waiter_tables: "table_assignments + the claim mechanism ... is a
// minimal, explicitly-flagged fill for [the assignment] gap — one active
// assignment per table, waiters claim an unassigned table, managers can
// reassign." This is that endpoint.
//
// A plain waiter may only claim a table with no existing assignment, or
// re-claim their own. A manager/owner may reassign any table to any
// waiter (optionally naming a target waiterUserId in the body; defaults
// to themselves, mirroring a manager stepping in to cover a table).

export async function POST(request: Request, { params }: { params: { tableId: string } }) {
  const auth = await requireStaffSession(request, ["waiter", "manager", "owner"]);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const isManager = session.roles.includes("manager") || session.roles.includes("owner");

  let targetWaiterId = session.userId;
  if (isManager) {
    const body = await request.json().catch(() => ({}) as { waiterUserId?: string });
    if (body?.waiterUserId) targetWaiterId = body.waiterUserId;
  }

  const service = createServiceClient();
  const { data: table, error: tableErr } = await service
    .from("venue_tables")
    .select("id")
    .eq("id", params.tableId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (tableErr || !table) {
    return NextResponse.json({ error: "table not found" }, { status: 404 });
  }

  const pg = createPgClient();

  const { rows: existingRows } = await pg.query(
    `SELECT waiter_user_id FROM table_assignments WHERE table_id = $1`,
    [params.tableId],
  );
  const existingWaiterId = existingRows[0]?.waiter_user_id as string | undefined;

  if (existingWaiterId && existingWaiterId !== targetWaiterId && !isManager) {
    return NextResponse.json({ error: "table already assigned", assignedTo: existingWaiterId }, { status: 409 });
  }

  await pg.query(
    `INSERT INTO table_assignments (tenant_id, table_id, waiter_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (table_id) DO UPDATE SET waiter_user_id = excluded.waiter_user_id, assigned_at = now()`,
    [session.tenantId, params.tableId, targetWaiterId],
  );

  return NextResponse.json({ status: "ok", tableId: params.tableId, waiterUserId: targetWaiterId });
}
