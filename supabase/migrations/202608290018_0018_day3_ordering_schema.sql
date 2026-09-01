-- 0018_day3_ordering_schema
-- Section 04: counter/table beverage ordering. orders/order_items,
-- venue_tables, table_reservations, cash_movements already exist from
-- Day 1, but nothing represents a menu, a bar/kitchen station, or which
-- table/station an order belongs to. Adding what's missing.

CREATE TABLE public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  code text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  qr_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stations_kind_check CHECK (kind IN ('bar', 'kitchen')),
  CONSTRAINT stations_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT stations_qr_token_unique UNIQUE (qr_token)
);

CREATE TABLE public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  station text NOT NULL,
  price_pesewas integer NOT NULL,
  in_stock boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT menu_items_station_check CHECK (station IN ('bar', 'kitchen')),
  CONSTRAINT menu_items_price_nonneg CHECK (price_pesewas >= 0)
);

CREATE INDEX menu_items_tenant_station_idx ON public.menu_items (tenant_id, station, in_stock);

-- Exactly one of table_id/station_id: a counter order has no table, a
-- table order has no station. customer_phone is required at checkout
-- per spec ("enters their phone number, required for order status and
-- any refunds") for both contexts.
ALTER TABLE public.orders
  ADD COLUMN table_id uuid REFERENCES public.venue_tables (id),
  ADD COLUMN station_id uuid REFERENCES public.stations (id),
  ADD COLUMN customer_phone text,
  ADD CONSTRAINT orders_exactly_one_target CHECK (
    (table_id IS NOT NULL AND station_id IS NULL) OR
    (table_id IS NULL AND station_id IS NOT NULL)
  );

-- order_items already snapshots name/unit_price at time of order (correct
-- — historical pricing must not drift if the menu changes later). Adding
-- a nullable menu_item_id purely for traceability, never for pricing.
ALTER TABLE public.order_items
  ADD COLUMN menu_item_id uuid REFERENCES public.menu_items (id);

-- RLS: stations and menu_items are new tenant-scoped tables and need the
-- same FORCE RLS + tenant_isolation pattern as everything else (orders/
-- order_items already have it from Day 1 — see the day1 migration's
-- FOREACH loop and its explicit 'orders'/'order_items' policies).
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.stations
  FOR ALL
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public.menu_items
  FOR ALL
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
