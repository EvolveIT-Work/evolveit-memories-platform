import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Extremely narrow Edge Function: After phone OTP, return material the browser needs for local TOTP
// - Expects POST JSON { ticket_id }
// - Verifies an extremely small stubbed phone OTP via header 'x-phone-otp' matching STUB_PHONE_OTP env (do not use in production)
// - Decrypts tickets.totp_secret_enc (stored as base64 iv||ciphertext||tag) with PLATFORM_AES_KEY_B64
// - Inserts a live_ticket_sessions row and returns { session_token, secret_b64 }
// Important: never log secrets or plaintext material

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PLATFORM_AES_KEY_B64 = process.env.PLATFORM_AES_KEY_B64!;
const STUB_PHONE_OTP = process.env.STUB_PHONE_OTP ?? 'stub-otp';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !PLATFORM_AES_KEY_B64) {
  console.warn('live-ticket-session: required env vars may be missing');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function decryptPlatformEncryptedBase64(encB64: string): Buffer {
  const key = Buffer.from(PLATFORM_AES_KEY_B64, 'base64');
  if (key.length !== 32) throw new Error('platform AES key invalid length');
  const data = Buffer.from(encB64, 'base64');
  if (data.length < 12 + 16) throw new Error('ciphertext too short');
  const iv = data.slice(0, 12);
  const tag = data.slice(data.length - 16);
  const ciphertext = data.slice(12, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext;
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method?.toUpperCase() !== 'POST') return res.status(405).send('method');

    const otpHeader = req.headers['x-phone-otp'] || req.headers['X-Phone-Otp'];
    if (!otpHeader || otpHeader !== STUB_PHONE_OTP) {
      return res.status(401).send('invalid otp');
    }

    const body = await (async () => {
      try {
        const raw = Buffer.from(await req.arrayBuffer());
        return JSON.parse(raw.toString('utf8'));
      } catch (e) {
        return null;
      }
    })();

    if (!body || !body.ticket_id) return res.status(400).send('missing ticket_id');

    const ticketId: string = body.ticket_id;

    // Fetch the ticket row and totp_secret_enc
    const { data: tickets, error: tErr } = await supabase
      .from('tickets')
      .select('id, tenant_id, totp_secret_enc')
      .eq('id', ticketId)
      .maybeSingle();

    if (tErr) {
      console.error('live-ticket-session: db read error', tErr.message);
      return res.status(500).send('db error');
    }

    if (!tickets) return res.status(404).send('ticket not found');
    if (!tickets.totp_secret_enc) return res.status(400).send('no totp secret');

    // Decrypt totp_secret_enc (do not log the plaintext)
    let secretPlain: Buffer;
    try {
      secretPlain = decryptPlatformEncryptedBase64(tickets.totp_secret_enc);
    } catch (e: any) {
      console.error('live-ticket-session: decryption error');
      return res.status(500).send('decryption error');
    }

    // Create a live_ticket_session record (store encrypted secret_enc value rather than plaintext)
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    const { error: insErr } = await supabase
      .from('live_ticket_sessions')
      .insert({ tenant_id: tickets.tenant_id, ticket_id: ticketId, session_token: sessionToken, secret_enc: tickets.totp_secret_enc, expires_at: expiresAt })
      .select('id')
      .maybeSingle();

    if (insErr) {
      console.error('live-ticket-session: insert error', insErr.message);
      return res.status(500).send('db error');
    }

    // Return session token and plaintext secret encoded as base64 (browser will decode and use WebCrypto)
    const secretB64 = secretPlain.toString('base64');

    return res.status(200).json({ session_token: sessionToken, secret_b64: secretB64, expires_at: expiresAt });
  } catch (err: any) {
    console.error('live-ticket-session: unexpected error', err && err.message ? err.message : err);
    return res.status(500).send('internal error');
  }
}
