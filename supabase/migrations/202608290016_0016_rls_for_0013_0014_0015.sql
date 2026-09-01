-- 0016_rls_for_0013_0014_0015
-- 0013/0014/0015 (delivery_queue, refund_requests, live_ticket_sessions)
-- were created without RLS, unlike every other tenant-scoped table.
-- Closing that gap with the exact same pattern used everywhere else
-- (202608270001_day1_schema_rls.sql).
--
-- Applied directly to the live DB via the Supabase connector on
-- 2026-08-29; written back here so the repo matches the live database
-- (see DAY2 postmortem: 0013/0014/0015 themselves were in the repo but
-- never applied live for weeks — never let that drift happen again in
-- either direction).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['delivery_queue', 'refund_requests', 'live_ticket_sessions']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
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
