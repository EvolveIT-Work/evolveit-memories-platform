export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-service";
import { createPgClient } from "@/lib/pg-pool";

// Ticket delivery (Section 6: WhatsApp primary, SMS fallback, email).
// STUB MODE: no WhatsApp/SMS/email provider credentials are configured
// in this environment, so this marks pending deliveries as 'sent'
// without a real network call — matching the project's existing,
// already-agreed stub-mode scope for Day 2. Real delivery needs a Meta
// WhatsApp Business Cloud API phone number, access token, and an
// approved message template (Meta must pre-approve business-initiated
// templates before they can be sent) — none of that can be wired up
// without those credentials from the tenant.
//
// The previous (dead, never-deployed) copy of this logic under
// supabase/functions/process-deliveries also called `supabase.raw(...)`,
// which is not a real supabase-js API and would have thrown at runtime
// even if that file had ever been reachable. Fixed here via a plain SQL
// UPDATE through the pg pool.

export async function POST() {
  const service = createServiceClient();
  const pg = createPgClient();

  const { data, error } = await service
    .from("delivery_queue")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ status: "no deliveries" });
  }

  const ids = data.map((r) => r.id as string);

  // WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are unset in this
  // environment, so this stays in stub mode. When real credentials are
  // added, this is where the Meta Cloud API call goes, per-row, before
  // marking sent — never marking sent before a real send succeeds.
  const hasRealProvider = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

  await pg.query(
    `UPDATE delivery_queue SET status = 'sent', attempts = attempts + 1, last_attempt_at = now() WHERE id = ANY($1::uuid[])`,
    [ids],
  );

  return NextResponse.json({
    status: hasRealProvider ? "sent" : "sent (stub — no provider configured)",
    count: ids.length,
  });
}
