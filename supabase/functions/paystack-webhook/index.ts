import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Paystack webhook handler (Edge Function)
// - Verifies HMAC-SHA512 on raw body against x-paystack-signature
// - Idempotent insert into webhook_events (duplicate -> 200)
// - On charge.success -> generates 160-bit secrets, encrypts them with platform AES-256-GCM key,
//   and calls app.issue_tickets_for_payment RPC passing p_encrypted_secrets bytea[]
// Do NOT call redeemTicket() here; this function issues tickets with status='issued'.

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET!;
const PLATFORM_AES_KEY_B64 = process.env.PLATFORM_AES_KEY_B64!; // base64-encoded 32-byte key

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !PAYSTACK_SECRET || !PLATFORM_AES_KEY_B64) {
  // Deployment should ensure these are present. Avoid logging secrets.
  console.warn('paystack-webhook: required env vars may be missing');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

function timingSafeEqualHex(aHex: string, bHex: string) {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

function encryptSecretWithPlatformKey(secret: Buffer): string {
  const key = Buffer.from(PLATFORM_AES_KEY_B64, 'base64');
  if (key.length !== 32) {
    throw new Error('platform AES key must be 32 bytes (base64 of 32 bytes)');
  }
  const iv = crypto.randomBytes(12); // 96-bit nonce for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as iv || ciphertext || tag, base64-encoded
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

// Supabase Functions runtime compatibility: export as default handler
export default async function handler(req: any, res: any) {
  try {
    const signatureHeader = req.headers['x-paystack-signature'] || req.headers['X-Paystack-Signature'];
    if (!signatureHeader) {
      return res.status(401).send('missing signature');
    }

    // Read raw body as buffer before JSON parsing
    const rawBuffer = Buffer.from(await req.arrayBuffer());

    const hmac = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBuffer).digest('hex');

    if (!timingSafeEqualHex(signatureHeader, hmac)) {
      return res.status(401).send('invalid signature');
    }

    // Safe to parse JSON now
    const payload = JSON.parse(rawBuffer.toString('utf8'));

    // Determine an idempotency key from the Paystack payload. Prefer payload.id, fallback to data.reference
    const paystackEventId: string | undefined = payload?.id ?? payload?.event ?? payload?.data?.id ?? payload?.data?.reference;

    if (!paystackEventId) {
      // Malformed payload
      return res.status(400).send('missing paystack event id');
    }

    // Attempt idempotent insert into webhook_events. If duplicate, return 200 immediately.
    const insertResp = await supabase
      .from('webhook_events')
      .insert({ paystack_event_id: paystackEventId })
      .select('id')
      .maybeSingle();

    if (insertResp.error) {
      // If unique violation (duplicate) -> treat as already-processed and return 200
      const msg = (insertResp.error.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique') || (insertResp.error.code && insertResp.error.code === '23505')) {
        return res.status(200).send('already processed');
      }
      // Other DB errors -> 500
      console.error('paystack-webhook: webhook_events insert error', insertResp.error.message);
      return res.status(500).send('db error');
    }

    // Only handle charge.success for ticket issuance
    const eventType: string | undefined = payload?.event ?? payload?.type;

    if (eventType === 'charge.success' || (typeof payload?.data?.status === 'string' && payload?.data?.status === 'success')) {
      // Extract necessary fields from payload.data. Expect metadata to contain tenant_id, buyer_user_id, ticket_type_id, qty
      const data = payload.data || {};
      const metadata = data.metadata ?? {};

      const tenant_id = metadata.tenant_id ?? metadata.tenantId;
      const buyer_user_id = metadata.buyer_user_id ?? metadata.buyerUserId ?? metadata.user_id ?? null;
      const ticket_type_id = metadata.ticket_type_id ?? metadata.ticketTypeId ?? null;
      const qty = Number(metadata.qty ?? metadata.quantity ?? 1);
      const amount = Number(data.amount ?? payload.amount ?? 0);

      if (!tenant_id || !ticket_type_id || !buyer_user_id) {
        // Missing required metadata to issue tickets atomically. Do not attempt partial issuance.
        console.error('paystack-webhook: missing metadata for issuance', { tenant_id, ticket_type_id, buyer_user_id });
        return res.status(400).send('missing metadata for issuance');
      }

      if (!Array.isArray(metadata) && (isNaN(qty) || qty <= 0)) {
        return res.status(400).send('invalid quantity');
      }

      // Generate 160-bit (20-byte) secrets and encrypt each with platform AES-256-GCM key
      const encryptedSecrets: string[] = [];
      try {
        for (let i = 0; i < qty; i++) {
          const secret = crypto.randomBytes(20); // 160-bit secret
          const enc = encryptSecretWithPlatformKey(secret);
          encryptedSecrets.push(enc);
        }
      } catch (e: any) {
        console.error('paystack-webhook: encryption error', e && e.message ? e.message : e);
        return res.status(500).send('encryption error');
      }

      // Call the Postgres function app.issue_tickets_for_payment with encrypted secrets array
      const rpcResp = await supabase.rpc('issue_tickets_for_payment', {
        p_tenant_id: tenant_id,
        p_buyer_user_id: buyer_user_id,
        p_paystack_ref: data.reference ?? data?.transaction?.reference ?? null,
        p_ticket_type_id: ticket_type_id,
        p_qty: qty,
        p_amount_pesewas: amount,
        p_metadata: metadata,
        p_encrypted_secrets: encryptedSecrets
      });

      if (rpcResp.error) {
        console.error('paystack-webhook: issue_tickets_for_payment rpc error', rpcResp.error.message);
        // If stock short or business error, return 400 so Paystack can be retried or operator can act; keep webhook_event recorded
        return res.status(400).send('issuance failed');
      }

      // Successful issuance
      return res.status(200).send('ok');
    }

    // For other events, simply acknowledge
    return res.status(200).send('ignored');
  } catch (err: any) {
    console.error('paystack-webhook: unexpected error', err && err.message ? err.message : err);
    return res.status(500).send('internal error');
  }
}
