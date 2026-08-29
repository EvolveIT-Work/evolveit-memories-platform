import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-service';
import { decryptTotpSecret } from '@evolveit/shared';
import { getPlatformAesKey } from '@/lib/pg-pool';
import crypto from 'crypto';

// Server route proxying to DB to create a live ticket session.
// This keeps the service role key server-side and provides a single narrow endpoint for the browser.
//
// This is the route the browser (apps/web/src/app/t/[ticketId]/page.tsx)
// actually calls — the file under supabase/functions/live-ticket-session
// looks identical in purpose but is never deployed/reachable in this
// project. Fix decryption here, not there.

export async function POST(req: Request) {
  try {
    const header = req.headers.get('x-phone-otp') ?? '';
    const STUB_PHONE_OTP = process.env.STUB_PHONE_OTP ?? 'stub-otp';
    if (header !== STUB_PHONE_OTP) return NextResponse.json({ error: 'invalid otp' }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body || !body.ticket_id) return NextResponse.json({ error: 'missing ticket_id' }, { status: 400 });

    const ticketId: string = body.ticket_id;

    const supabase = createServiceClient();

    const { data: ticket, error: tErr } = await supabase
      .from('tickets')
      .select('id, tenant_id, totp_secret_enc')
      .eq('id', ticketId)
      .maybeSingle();

    if (tErr) {
      console.error('api/live-ticket-session: db read error', tErr.message);
      return NextResponse.json({ error: 'db error' }, { status: 500 });
    }

    if (!ticket) return NextResponse.json({ error: 'ticket not found' }, { status: 404 });
    if (!ticket.totp_secret_enc) return NextResponse.json({ error: 'no totp secret' }, { status: 400 });

    // Decrypt using the shared crypto module — same AES-256-GCM layout
    // (iv || authTag || ciphertext) used everywhere else this secret is
    // touched (paystack-webhook, sync-pull, the redeem adapters).
    let plaintext: Buffer;
    try {
      const key = getPlatformAesKey();
      plaintext = decryptTotpSecret(Buffer.from(ticket.totp_secret_enc, 'base64'), key);
    } catch (e) {
      console.error('api/live-ticket-session: decryption error');
      return NextResponse.json({ error: 'decryption error' }, { status: 500 });
    }

    // Create live_ticket_sessions row
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const { error: insErr } = await supabase
      .from('live_ticket_sessions')
      .insert({ tenant_id: ticket.tenant_id, ticket_id: ticketId, session_token: sessionToken, secret_enc: ticket.totp_secret_enc, expires_at: expiresAt })
      .select('id')
      .maybeSingle();

    if (insErr) {
      console.error('api/live-ticket-session: insert error', insErr.message);
      return NextResponse.json({ error: 'db error' }, { status: 500 });
    }

    // Return session token and plaintext secret as base64
    return NextResponse.json({ session_token: sessionToken, secret_b64: plaintext.toString('base64'), expires_at: expiresAt });
  } catch (err: any) {
    console.error('api/live-ticket-session unexpected', err && err.message ? err.message : err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
