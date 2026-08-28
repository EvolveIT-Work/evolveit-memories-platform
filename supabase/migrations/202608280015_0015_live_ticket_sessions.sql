-- 0015_live_ticket_sessions
-- Store ephemeral live ticket sessions that may hold encrypted TOTP material for browser-local TOTP computation

CREATE TABLE public.live_ticket_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  session_token text NOT NULL,
  secret_enc text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_ticket_sessions_token_unique UNIQUE (tenant_id, session_token)
);

CREATE INDEX live_ticket_sessions_ticket_idx ON public.live_ticket_sessions (ticket_id);
