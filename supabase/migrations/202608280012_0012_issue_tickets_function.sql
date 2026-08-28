-- 0012_issue_tickets_function
-- Atomic stock decrement, create tickets status='issued', ledger entries, delivery_queue rows, and payment record
-- Now accepts p_encrypted_secrets bytea[] and correctly uses ticket_types.price_pesewas and remaining.

CREATE OR REPLACE FUNCTION app.issue_tickets_for_payment(
  p_tenant_id uuid,
  p_buyer_user_id uuid,
  p_paystack_ref text,
  p_ticket_type_id uuid,
  p_qty integer,
  p_amount_pesewas integer,
  p_metadata jsonb,
  p_encrypted_secrets bytea[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment_id uuid;
  v_ticket_id uuid;
  v_unit_price integer;
  v_remaining integer;
  v_i integer;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'quantity must be > 0';
  END IF;

  IF array_length(p_encrypted_secrets, 1) IS NULL OR array_length(p_encrypted_secrets, 1) <> p_qty THEN
    RAISE EXCEPTION 'encrypted_secrets length must equal qty';
  END IF;

  -- Fetch unit price and remaining stock
  SELECT price_pesewas, remaining INTO v_unit_price, v_remaining
    FROM public.ticket_types
    WHERE id = p_ticket_type_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket_type not found';
  END IF;

  IF v_remaining < p_qty THEN
    RAISE EXCEPTION 'insufficient_stock';
  END IF;

  -- Atomically decrement remaining stock
  UPDATE public.ticket_types
  SET remaining = remaining - p_qty
  WHERE id = p_ticket_type_id
    AND tenant_id = p_tenant_id
    AND remaining >= p_qty;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'insufficient_stock';
  END IF;

  -- Validate provided total amount matches expected unit price * qty
  IF p_amount_pesewas IS DISTINCT FROM (v_unit_price * p_qty) THEN
    RAISE EXCEPTION 'amount_mismatch_expected_%', (v_unit_price * p_qty);
  END IF;

  -- Insert payment record
  INSERT INTO public.payments(tenant_id, paystack_ref, status, amount_pesewas)
  VALUES (p_tenant_id, p_paystack_ref, 'paid', p_amount_pesewas)
  RETURNING id INTO v_payment_id;

  -- Create tickets, ticket_payments, ledger_entries, and delivery_queue rows
  FOR v_i IN 1..p_qty LOOP
    INSERT INTO public.tickets (tenant_id, event_id, ticket_type_id, buyer_user_id, serial, status, totp_secret_enc)
    SELECT tt.tenant_id, tt.event_id, tt.id, p_buyer_user_id, gen_random_uuid()::text, 'issued',
      encode(p_encrypted_secrets[v_i], 'base64')
    FROM public.ticket_types tt
    WHERE tt.id = p_ticket_type_id
    RETURNING id INTO v_ticket_id;

    INSERT INTO public.ticket_payments (tenant_id, ticket_id, paystack_ref, amount_pesewas)
    VALUES (p_tenant_id, v_ticket_id, p_paystack_ref, v_unit_price);

    INSERT INTO public.ledger_entries (tenant_id, event_id, account, amount_pesewas, actor_user_id, paystack_ref)
    VALUES (p_tenant_id, (SELECT event_id FROM public.ticket_types WHERE id = p_ticket_type_id), 'ticket_revenue', v_unit_price, p_buyer_user_id, p_paystack_ref);

    INSERT INTO public.delivery_queue (tenant_id, ticket_id, provider, recipient, payload)
    VALUES (p_tenant_id, v_ticket_id, 'stub', NULL, jsonb_build_object('metadata', p_metadata));
  END LOOP;

  RETURN v_payment_id;
END;
$$;
