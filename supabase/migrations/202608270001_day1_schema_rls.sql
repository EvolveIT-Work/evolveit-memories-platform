-- EvolveIT Memories Platform — Day 1
-- Spec: Section 10 (schema + RLS), Section 06 (ledger), Section 11 (auth/devices),
-- Section 12 Day 1, Appendix B prohibitions 4, 5, 6, 7.
-- All customer-facing and operational PKs are UUID (prohibition 7).
-- All money columns are INTEGER pesewas (prohibition 5). Never float/numeric.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_unique UNIQUE (slug),
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

-- ---------------------------------------------------------------------------
-- tenant_features  PK (tenant_id, feature_key)
-- ---------------------------------------------------------------------------
CREATE TABLE public.tenant_features (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key),
  CONSTRAINT tenant_features_key_check CHECK (
    feature_key IN (
      'ticketing',
      'ordering.counter',
      'ordering.table',
      'accounting',
      'organiser',
      'venue'
    )
  )
);

-- ---------------------------------------------------------------------------
-- users  UNIQUE(tenant_id, phone) UNIQUE(tenant_id, email)
-- ---------------------------------------------------------------------------
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  phone text,
  email citext,
  display_name text NOT NULL,
  token_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_phone_unique UNIQUE (tenant_id, phone),
  CONSTRAINT users_email_unique UNIQUE (tenant_id, email),
  CONSTRAINT users_token_version_positive CHECK (token_version >= 1),
  CONSTRAINT users_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$')
);

-- SECURITY DEFINER: reading public.users must not re-enter FORCE RLS
-- (otherwise tenant_isolation → current_tenant_id → users → infinite recursion).
CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.tenant_id', true), '')::uuid,
    (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION app.current_device_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT NULLIF(current_setting('app.device_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.set_device_context(p_tenant_id uuid, p_device_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
  PERFORM set_config('app.device_id', p_device_id::text, true);
END;
$$;

REVOKE ALL ON FUNCTION app.set_device_context(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_device_context(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- user_roles  PK (user_id, tenant_id, role)
-- ---------------------------------------------------------------------------
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  role text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id, role),
  CONSTRAINT user_roles_role_check CHECK (
    role IN (
      'owner',
      'manager',
      'door',
      'waiter',
      'bartender',
      'kitchen',
      'cashier',
      'organiser'
    )
  )
);

-- ---------------------------------------------------------------------------
-- devices  credential stored as argon2 hash (Section 11)
-- ---------------------------------------------------------------------------
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  role text NOT NULL,
  label text NOT NULL,
  event_ids uuid[] NOT NULL DEFAULT '{}',
  credential_hash text NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_role_check CHECK (
    role IN ('hub', 'door', 'bar_display', 'kitchen_display')
  )
);

CREATE INDEX devices_tenant_role_idx ON public.devices (tenant_id, role);

-- ---------------------------------------------------------------------------
-- shifts  one open shift per tenant
-- ---------------------------------------------------------------------------
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  opened_by uuid NOT NULL REFERENCES public.users (id),
  closed_by uuid REFERENCES public.users (id),
  hub_device_id uuid REFERENCES public.devices (id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT shifts_closed_requires_closer CHECK (
    (closed_at IS NULL AND closed_by IS NULL)
    OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)
  )
);

CREATE UNIQUE INDEX shifts_one_open_per_tenant
  ON public.shifts (tenant_id)
  WHERE closed_at IS NULL;

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  check_in_from timestamptz NOT NULL,
  check_in_until timestamptz NOT NULL,
  event_private_key_enc text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_time_window CHECK (starts_at < ends_at),
  CONSTRAINT events_checkin_window CHECK (check_in_from < check_in_until)
);

-- ---------------------------------------------------------------------------
-- ticket_types  remaining CHECK (>= 0); decrement only via webhook (Day 2)
-- ---------------------------------------------------------------------------
CREATE TABLE public.ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events (id) ON DELETE CASCADE,
  name text NOT NULL,
  price_pesewas integer NOT NULL,
  remaining integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_types_remaining_nonneg CHECK (remaining >= 0),
  CONSTRAINT ticket_types_price_nonneg CHECK (price_pesewas >= 0)
);

-- ---------------------------------------------------------------------------
-- tickets  totp_secret_enc never in API/logs (prohibition 6)
-- ---------------------------------------------------------------------------
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events (id),
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types (id),
  buyer_user_id uuid NOT NULL REFERENCES public.users (id),
  serial text NOT NULL,
  status text NOT NULL,
  totp_secret_enc text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_status_check CHECK (
    status IN ('reserved', 'issued', 'used', 'voided')
  ),
  CONSTRAINT tickets_serial_unique UNIQUE (tenant_id, serial)
);

-- ---------------------------------------------------------------------------
-- ticket_redemptions  UNIQUE(ticket_id) INSERT only (Section 10)
-- ---------------------------------------------------------------------------
CREATE TABLE public.ticket_redemptions (
  ticket_id uuid PRIMARY KEY REFERENCES public.tickets (id),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices (id),
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- ticket_payments
-- ---------------------------------------------------------------------------
CREATE TABLE public.ticket_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets (id),
  paystack_ref text NOT NULL,
  refund_ref text,
  amount_pesewas integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_payments_paystack_ref_unique UNIQUE (paystack_ref),
  CONSTRAINT ticket_payments_refund_ref_unique UNIQUE (refund_ref),
  CONSTRAINT ticket_payments_amount_nonneg CHECK (amount_pesewas >= 0)
);

-- ---------------------------------------------------------------------------
-- ownership_history  append-only
-- ---------------------------------------------------------------------------
CREATE TABLE public.ownership_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets (id),
  from_user_id uuid REFERENCES public.users (id),
  to_user_id uuid NOT NULL REFERENCES public.users (id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ownership_history_reason_check CHECK (
    reason IN ('purchase', 'transfer', 'reissue_lost', 'reissue_stolen', 'admin')
  )
);

-- ---------------------------------------------------------------------------
-- revocations  PK ticket_id
-- ---------------------------------------------------------------------------
CREATE TABLE public.revocations (
  ticket_id uuid PRIMARY KEY REFERENCES public.tickets (id),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  reason text NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- webhook_events  paystack_event_id UNIQUE — insert before business logic (Day 2)
-- ---------------------------------------------------------------------------
CREATE TABLE public.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE CASCADE,
  paystack_event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_events_paystack_event_id_unique UNIQUE (paystack_event_id)
);

-- ---------------------------------------------------------------------------
-- ledger_entries  append-only, integer pesewas (prohibitions 4, 5)
-- ---------------------------------------------------------------------------
CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events (id),
  shift_id uuid REFERENCES public.shifts (id),
  account text NOT NULL,
  amount_pesewas integer NOT NULL,
  actor_user_id uuid REFERENCES public.users (id),
  device_id uuid REFERENCES public.devices (id),
  paystack_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_account_check CHECK (
    account IN (
      'momo_clearing',
      'cash_drawer',
      'ticket_revenue',
      'fb_revenue',
      'deposit_liability',
      'forfeiture_income',
      'refunds',
      'comps',
      'paystack_fees',
      'organiser_payable'
    )
  )
);

CREATE INDEX ledger_entries_tenant_account_idx
  ON public.ledger_entries (tenant_id, account, created_at);

-- ---------------------------------------------------------------------------
-- payments  Paystack webhook outcomes
-- ---------------------------------------------------------------------------
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  paystack_ref text NOT NULL,
  status text NOT NULL,
  amount_pesewas integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_paystack_ref_unique UNIQUE (paystack_ref),
  CONSTRAINT payments_amount_nonneg CHECK (amount_pesewas >= 0)
);

-- ---------------------------------------------------------------------------
-- venue_tables
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  label text NOT NULL,
  zone text NOT NULL,
  seating_capacity integer NOT NULL,
  qr_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_tables_qr_token_unique UNIQUE (qr_token),
  CONSTRAINT venue_tables_capacity_positive CHECK (seating_capacity > 0)
);

-- ---------------------------------------------------------------------------
-- table_reservations
-- ---------------------------------------------------------------------------
CREATE TABLE public.table_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.venue_tables (id),
  status text NOT NULL,
  deposit_pesewas integer NOT NULL DEFAULT 0,
  reserved_for timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_reservations_status_check CHECK (
    status IN ('reserved', 'arrived', 'no_show', 'cancelled')
  ),
  CONSTRAINT table_reservations_deposit_nonneg CHECK (deposit_pesewas >= 0)
);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  payment_source text NOT NULL,
  status text NOT NULL,
  local_ref text NOT NULL,
  amount_pesewas integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_payment_source_check CHECK (payment_source IN ('momo', 'cash')),
  CONSTRAINT orders_status_check CHECK (
    status IN ('pending_pay', 'paid', 'preparing', 'ready', 'complete', 'voided')
  ),
  CONSTRAINT orders_local_ref_unique UNIQUE (tenant_id, local_ref),
  CONSTRAINT orders_amount_nonneg CHECK (amount_pesewas >= 0)
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  station text NOT NULL,
  status text NOT NULL,
  name text NOT NULL,
  qty integer NOT NULL,
  unit_price_pesewas integer NOT NULL,
  CONSTRAINT order_items_station_check CHECK (station IN ('bar', 'kitchen')),
  CONSTRAINT order_items_qty_positive CHECK (qty > 0),
  CONSTRAINT order_items_price_nonneg CHECK (unit_price_pesewas >= 0)
);

-- ---------------------------------------------------------------------------
-- cash_movements  waiter + shift not nullable (Section 10)
-- ---------------------------------------------------------------------------
CREATE TABLE public.cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  attributed_waiter_id uuid NOT NULL REFERENCES public.users (id),
  shift_id uuid NOT NULL REFERENCES public.shifts (id),
  amount_pesewas integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_movements_amount_positive CHECK (amount_pesewas > 0)
);

-- ---------------------------------------------------------------------------
-- settlement_statements
-- ---------------------------------------------------------------------------
CREATE TABLE public.settlement_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events (id),
  status text NOT NULL,
  organiser_total_pesewas integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_statements_status_check CHECK (
    status IN ('draft', 'approved', 'paid')
  )
);

-- ---------------------------------------------------------------------------
-- Immutability triggers (Section 10, prohibition 4)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are immutable. Create a correcting entry.';
END;
$$;

CREATE TRIGGER ledger_immutable
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION app.prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'This table is append-only.';
END;
$$;

CREATE TRIGGER ticket_redemptions_append_only
  BEFORE UPDATE OR DELETE ON public.ticket_redemptions
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_append_only_mutation();

CREATE TRIGGER ownership_history_append_only
  BEFORE UPDATE OR DELETE ON public.ownership_history
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_append_only_mutation();

REVOKE UPDATE, DELETE ON public.ledger_entries FROM PUBLIC, anon, authenticated;
GRANT INSERT, SELECT ON public.ledger_entries TO authenticated;

-- ---------------------------------------------------------------------------
-- FORCE RLS on every tenant-scoped table (Section 10)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants',
    'tenant_features',
    'users',
    'user_roles',
    'devices',
    'shifts',
    'events',
    'ticket_types',
    'tickets',
    'ticket_redemptions',
    'ticket_payments',
    'ownership_history',
    'revocations',
    'webhook_events',
    'ledger_entries',
    'payments',
    'venue_tables',
    'table_reservations',
    'orders',
    'order_items',
    'cash_movements',
    'settlement_statements'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$$;

-- tenants: isolation by id
CREATE POLICY tenant_isolation ON public.tenants
  FOR ALL
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());

-- Generic tenant_isolation for tables that have tenant_id
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_features',
    'users',
    'user_roles',
    'devices',
    'shifts',
    'events',
    'ticket_types',
    'ticket_payments',
    'ownership_history',
    'revocations',
    'webhook_events',
    'ledger_entries',
    'payments',
    'venue_tables',
    'table_reservations',
    'orders',
    'order_items',
    'settlement_statements'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         FOR ALL
         USING (tenant_id = app.current_tenant_id())
         WITH CHECK (tenant_id = app.current_tenant_id())',
      t
    );
  END LOOP;
END;
$$;

-- Tickets: tenant isolation on read/update/delete only.
-- INSERT is service_role only so staff cannot bypass webhook issuance (Section 10).
CREATE POLICY tenant_isolation ON public.tickets
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_tickets_update ON public.tickets
  FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY tenant_isolation_tickets_delete ON public.tickets
  FOR DELETE
  USING (tenant_id = app.current_tenant_id());

-- Tickets: customers see only their own (Section 10) — OR'd with tenant SELECT
CREATE POLICY customer_own_tickets ON public.tickets
  FOR SELECT
  USING (buyer_user_id = auth.uid());

-- Ticket issuance: service role only (Section 10)
CREATE POLICY service_role_insert_tickets ON public.tickets
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY tenant_isolation ON public.ticket_redemptions
  FOR SELECT
  USING (tenant_id = app.current_tenant_id());

CREATE POLICY scanner_can_redeem ON public.ticket_redemptions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.devices
      WHERE id = app.current_device_id()
        AND role IN ('hub', 'door')
        AND revoked_at IS NULL
    )
  );

CREATE POLICY tenant_isolation ON public.cash_movements
  FOR SELECT
  USING (
    tenant_id = app.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.tenant_id = cash_movements.tenant_id
        AND ur.role IN ('owner', 'manager', 'cashier')
    )
  );

-- Cash: waiter sees/inserts own (Section 10)
CREATE POLICY waiter_own_cash ON public.cash_movements
  USING (attributed_waiter_id = auth.uid())
  WITH CHECK (attributed_waiter_id = auth.uid());

-- Column privileges: never expose TOTP / event key material (prohibition 6)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_device_id() TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.tenants,
  public.tenant_features,
  public.users,
  public.user_roles,
  public.devices,
  public.shifts,
  public.ticket_types,
  public.ticket_payments,
  public.revocations,
  public.webhook_events,
  public.payments,
  public.venue_tables,
  public.table_reservations,
  public.orders,
  public.order_items,
  public.cash_movements,
  public.settlement_statements
TO authenticated;

GRANT SELECT, INSERT ON public.ownership_history TO authenticated;
GRANT SELECT, INSERT ON public.ticket_redemptions TO authenticated;
GRANT SELECT, INSERT ON public.ledger_entries TO authenticated;

-- tickets: authenticated may read non-secret columns only
GRANT SELECT (
  id,
  tenant_id,
  event_id,
  ticket_type_id,
  buyer_user_id,
  serial,
  status,
  created_at
) ON public.tickets TO authenticated;

-- INSERT on tickets is not granted to authenticated (service_role only).

-- events: hide event_private_key_enc from authenticated
GRANT SELECT (
  id,
  tenant_id,
  name,
  starts_at,
  ends_at,
  check_in_from,
  check_in_until,
  created_at
) ON public.events TO authenticated;

-- No INSERT/UPDATE/DELETE on events for authenticated: hides event_private_key_enc (Appendix B #6).

-- Seed venues (Section 02 multi-tenant). Auth users are created by bootstrap script.
INSERT INTO public.tenants (id, slug, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'memories-cape-coast', 'Memories Night Club'),
  ('22222222-2222-2222-2222-222222222222', 'evolveit-test-venue', 'EvolveIT Test Venue');

INSERT INTO public.tenant_features (tenant_id, feature_key, enabled)
SELECT t.id, k.feature_key, (t.slug = 'memories-cape-coast')
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('ticketing'),
    ('ordering.counter'),
    ('ordering.table'),
    ('accounting'),
    ('organiser'),
    ('venue')
) AS k(feature_key);

-- Day-1 acceptance probe (Section 12). service_role only.
CREATE OR REPLACE FUNCTION public.day1_force_rls_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(bool_and(c.relrowsecurity AND c.relforcerowsecurity), false)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY (ARRAY[
      'tenants','tenant_features','users','user_roles','devices','shifts','events',
      'ticket_types','tickets','ticket_redemptions','ticket_payments','ownership_history',
      'revocations','webhook_events','ledger_entries','payments','venue_tables',
      'table_reservations','orders','order_items','cash_movements','settlement_statements'
    ]);
$$;

REVOKE ALL ON FUNCTION public.day1_force_rls_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.day1_force_rls_ok() TO service_role;

