-- 0014_refund_requests
-- Track refund requests and their state

CREATE TABLE public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets(id),
  requester_user_id uuid REFERENCES public.users(id),
  amount_pesewas integer NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'requested',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT refund_requests_status_check CHECK (status IN ('requested','processed','rejected')),
  CONSTRAINT refund_requests_amount_nonneg CHECK (amount_pesewas >= 0)
);

CREATE INDEX refund_requests_payment_idx ON public.refund_requests (payment_id);
