-- 0023_waiter_tables
-- Section 04 "Table Cash Payment": the system is supposed to record
-- "the order ID, the amount, the waiter ID, and the timestamp" on a
-- Cash Received tap, but cash_movements has no order_id column at all —
-- adding it (nullable: not every future cash_movements row need be
-- order-specific, so this doesn't over-constrain other paths).
--
-- Section 04 "My Tables"/"All Tables" assume a waiter-to-table
-- assignment already exists, but neither the schema nor any screen
-- describes how it's created. table_assignments + the claim mechanism
-- (apps/web/api/v1/waiter/tables/[tableId]/claim) is a minimal,
-- explicitly-flagged fill for that gap — one active assignment per
-- table, waiters claim an unassigned table, managers can reassign.

ALTER TABLE public.cash_movements
  ADD COLUMN order_id uuid REFERENCES public.orders (id);

CREATE TABLE public.table_assignments (
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.venue_tables (id) ON DELETE CASCADE,
  waiter_user_id uuid NOT NULL REFERENCES public.users (id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_id)
);

ALTER TABLE public.table_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.table_assignments
  FOR ALL
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
