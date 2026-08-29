import { createHmac } from 'node:crypto';

const TOTP_STEP_SECONDS = 30;
const TOTP_CODE_DIGITS = 6;

/**
 * The TOTP secret is always raw binary (160-bit random, generated in
 * paystack-webhook). It must be used as raw bytes for HMAC — the browser
 * (apps/web/src/app/t/[ticketId]/page.tsx) imports it via WebCrypto
 * `importKey('raw', bytes, ...)` with no string/encoding step, so the
 * Node/hub side must match exactly. Do not round-trip through a string
 * encoding (utf8 mangles arbitrary bytes; guessing base32 is unreliable).
 * Base64 is used only at serialization boundaries (DB column, JSON, HTTP).
 */
export function generateTotpCode(secret: Buffer, timestampMs = Date.now()): string {
  const secretBytes = secret;
  const counter = Math.floor(timestampMs / 1000 / TOTP_STEP_SECONDS);
  const buffer = Buffer.alloc(8);
  let value = BigInt(counter);

  for (let index = 7; index >= 0; index -= 1) {
    buffer[index] = Number(value & 0xffn);
    value >>= 8n;
  }

  const hmac = createHmac('sha1', secretBytes)
    .update(buffer)
    .digest();

  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 10 ** TOTP_CODE_DIGITS).toString().padStart(TOTP_CODE_DIGITS, '0');
}

export function verifyTotpCode(secret: Buffer, code: string, nowMs = Date.now(), toleranceWindows = 1): boolean {
  const normalizedCode = code.trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const currentCounter = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  for (let offset = -toleranceWindows; offset <= toleranceWindows; offset += 1) {
    const candidate = generateTotpCode(secret, (currentCounter + offset) * TOTP_STEP_SECONDS * 1000);
    if (candidate === normalizedCode) {
      return true;
    }
  }

  return false;
}
