export const runtime = "nodejs";

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { randomBytes } from "node:crypto";
import { encryptTotpSecret } from "@evolveit/shared";
import { createServiceClient } from "@/lib/supabase-service";
import { getPlatformAesKey } from "@/lib/pg-pool";

// Real, wired Paystack webhook handler. The equivalent file under
// supabase/functions/paystack-webhook was never actually deployable in
// this project (no supabase/config.toml, no Deno-compatible handler
// signature) — this route is the one that runs. See
// apps/web/src/app/api/live-ticket-session/route.ts for the same lesson
// learned the hard way: a fix to the dead copy doesn't reach production.
//
// - Verifies HMAC-SHA512 on the raw body against x-paystack-signature
//   before parsing JSON (Appendix B #2).
// - Idempotent insert into webhook_events first; duplicate -> 200.
// - On charge.success, generates per-ticket 160-bit secrets, encrypts
//   each with the shared crypto module, and calls
//   issue_tickets_for_payment (one atomic transaction: stock decrement,
//   ticket insert, ledger insert, delivery enqueue).
// Never calls redeemTicket() here — this issues tickets, it never admits.

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, "hex");
    const b = Buffer.from(bHex, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const secret = process.env.PAYSTACK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "server config" }, { status: 500 });
  }

  const signatureHeader = request.headers.get("x-paystack-signature");
  if (!signatureHeader) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 });
  }

  // Raw bytes first — signature is over the exact wire bytes, not the
  // re-serialized JSON.
  const rawBuffer = Buffer.from(await request.arrayBuffer());
  const hmac = crypto.createHmac("sha512", secret).update(rawBuffer).digest("hex");
  if (!timingSafeEqualHex(signatureHeader, hmac)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBuffer.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const dataField = (payload.data ?? {}) as Record<string, unknown>;
  // Paystack's actual unique-per-transaction fields live under `data`
  // (reference/id). `payload.event` is the event *type* string
  // ("charge.success") — constant across every successful payment, not
  // an identifier. It must never be preferred over data.id/data.reference,
  // or every payment after the first is wrongly treated as a duplicate
  // and silently skipped (found by actually running this against a real
  // signed webhook call — every prior test run had been a no-op).
  const paystackEventId =
    (dataField.id as string | number | undefined)?.toString() ??
    (dataField.reference as string | undefined) ??
    (payload.id as string | undefined);

  if (!paystackEventId) {
    return NextResponse.json({ error: "missing paystack event id" }, { status: 400 });
  }

  const service = createServiceClient();

  const insertResp = await service
    .from("webhook_events")
    .insert({ paystack_event_id: paystackEventId })
    .select("id")
    .maybeSingle();

  if (insertResp.error) {
    const msg = (insertResp.error.message || "").toLowerCase();
    const isDuplicate =
      msg.includes("duplicate") || msg.includes("unique") || insertResp.error.code === "23505";
    if (isDuplicate) {
      return NextResponse.json({ status: "already processed" });
    }
    return NextResponse.json({ error: "db error" }, { status: 500 });
  }

  const eventType = (payload.event as string | undefined) ?? (payload.type as string | undefined);
  const isSuccess = eventType === "charge.success" || dataField.status === "success";

  if (!isSuccess) {
    return NextResponse.json({ status: "ignored" });
  }

  const metadata = (dataField.metadata ?? {}) as Record<string, unknown>;
  const tenantId = (metadata.tenant_id as string | undefined) ?? (metadata.tenantId as string | undefined);
  const buyerUserId =
    (metadata.buyer_user_id as string | undefined) ??
    (metadata.buyerUserId as string | undefined) ??
    (metadata.user_id as string | undefined);
  const ticketTypeId =
    (metadata.ticket_type_id as string | undefined) ?? (metadata.ticketTypeId as string | undefined);
  const qty = Number(metadata.qty ?? metadata.quantity ?? 1);
  const amount = Number(dataField.amount ?? payload.amount ?? 0);

  if (!tenantId || !ticketTypeId || !buyerUserId) {
    return NextResponse.json({ error: "missing metadata for issuance" }, { status: 400 });
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: "invalid quantity" }, { status: 400 });
  }

  const key = getPlatformAesKey();
  // bytea[] RPC parameters must arrive as Postgres hex-format text
  // ("\x..."); a plain base64 string is not valid bytea input syntax and
  // the RPC call fails outright. Discovered while wiring this route up
  // for real — the previous (dead) implementation sent base64 and had
  // never actually been exercised against Postgres.
  const encryptedSecretsHex: string[] = [];
  for (let i = 0; i < qty; i++) {
    const secretBytes = randomBytes(20);
    const encrypted = encryptTotpSecret(secretBytes, key);
    encryptedSecretsHex.push("\\x" + encrypted.toString("hex"));
  }

  // issue_tickets_for_payment lives in the `app` schema, not `public`
  // — PostgREST only searches schemas it's configured to expose
  // (default: public only), so this must target the schema explicitly.
  // Also requires "app" to be added under Supabase Project Settings →
  // API → Exposed schemas, or PostgREST returns the same "could not
  // find the function" error regardless of this fix.
  const rpcResp = await service.schema("app").rpc("issue_tickets_for_payment", {
    p_tenant_id: tenantId,
    p_buyer_user_id: buyerUserId,
    p_paystack_ref: (dataField.reference as string | undefined) ?? null,
    p_ticket_type_id: ticketTypeId,
    p_qty: qty,
    p_amount_pesewas: amount,
    p_metadata: metadata,
    p_encrypted_secrets: encryptedSecretsHex,
  });

  if (rpcResp.error) {
    return NextResponse.json({ error: "issuance failed", detail: rpcResp.error.message }, { status: 400 });
  }

  return NextResponse.json({ status: "ok" });
}
