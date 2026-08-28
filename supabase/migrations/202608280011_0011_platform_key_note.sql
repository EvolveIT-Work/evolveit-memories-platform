-- 0011_platform_key_note
-- Add clarifying comment that the platform TOTP encryption key is stored as an Edge Function secret

COMMENT ON COLUMN public.events.event_private_key_enc IS
  'Encrypted event private key. The plaintext AES-256-GCM platform key is stored as an Edge Function secret and must never be stored or logged in plaintext.';
