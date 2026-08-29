import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const AES_256_GCM_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function ensure256BitKey(key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error('TOTP platform key must be exactly 32 bytes (AES-256-GCM).');
  }
  return key;
}

/**
 * Binary-safe: plaintext is the raw TOTP secret bytes, never coerced
 * through a string encoding. Layout: iv || authTag || ciphertext.
 */
export function encryptTotpSecret(plaintext: Buffer, key: Buffer): Buffer {
  const normalizedKey = ensure256BitKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_256_GCM_ALGORITHM, normalizedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptTotpSecret(ciphertext: Buffer, key: Buffer): Buffer {
  const normalizedKey = ensure256BitKey(key);
  if (ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Ciphertext is too short to be a valid AES-256-GCM payload.');
  }

  const iv = ciphertext.subarray(0, IV_LENGTH);
  const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const payload = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(AES_256_GCM_ALGORITHM, normalizedKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(payload), decipher.final()]);
}
