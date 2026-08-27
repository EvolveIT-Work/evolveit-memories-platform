-- Patch for projects that already applied 202608270001.
-- Fixes: manager profile RLS/read failed: stack depth limit exceeded

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

REVOKE ALL ON FUNCTION app.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO authenticated, service_role;
