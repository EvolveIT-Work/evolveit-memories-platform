import { createHmac } from 'node:crypto';

const TOTP_STEP_SECONDS = 30;
const TOTP_CODE_DIGITS = 6;

export function decodeBase32(value: string): Buffer {
  const normalized = value.trim().replace(/=+$/g, '').toUpperCase();
  if (!normalized) {
    return Buffer.alloc(0);
  }

  let bits = '';
  for (const char of normalized) {
    const code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    if (code < 0) {
      throw new Error(`Invalid base32 character in TOTP secret: ${char}`);
    }
    bits += code.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

export function getTotpSecretBytes(secret: string): Buffer {
  const normalized = secret.trim();
  if (!normalized) {
    return Buffer.alloc(0);
  }

  const isBase32 = /^[A-Za-z2-7]+=*$/.test(normalized) && !/[0-9]/.test(normalized);
  return isBase32 ? decodeBase32(normalized) : Buffer.from(normalized, 'utf8');
}

export function generateTotpCode(secret: string, timestampMs = Date.now()): string {
  const secretBytes = getTotpSecretBytes(secret);
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

export function verifyTotpCode(secret: string, code: string, nowMs = Date.now(), toleranceWindows = 1): boolean {
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
