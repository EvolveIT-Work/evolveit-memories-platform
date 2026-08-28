-- 0013_delivery_queue
-- Delivery queue for stubbed Day 2 delivery providers (WhatsApp, SMS, Email). Day 2 runs in STUB mode: entries written, no external calls.

CREATE TABLE public.delivery_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  provider text NOT NULL,
  recipient text,
  payload jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_queue_status_check CHECK (status IN ('pending','sent','failed'))
);

CREATE INDEX delivery_queue_tenant_status_idx ON public.delivery_queue (tenant_id, status, created_at);
