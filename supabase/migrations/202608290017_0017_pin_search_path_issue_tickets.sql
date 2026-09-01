-- 0017_pin_search_path_issue_tickets
-- app.issue_tickets_for_payment is SECURITY DEFINER with a mutable
-- search_path — a privilege-escalation risk (a malicious search_path
-- could redirect an unqualified table/function reference inside it).
-- Pinning it.
--
-- Applied directly to the live DB via the Supabase connector on
-- 2026-08-29; written back here so the repo matches the live database.

ALTER FUNCTION app.issue_tickets_for_payment(uuid, uuid, text, uuid, integer, integer, jsonb, bytea[])
  SET search_path = public, app, pg_temp;
