-- 0024_cash_order_functions
-- Table-only cash payment path (Section 04, Reading B confirmed with
-- the user): checkout creates the order+order_items immediately but
-- held at status='pending_pay' with no ledger entry — invisible to
-- bar/kitchen displays (queue only ever shows status='paid') until the
-- assigned waiter's Cash Received action confirms it. The waiter's
-- attributed confirmation is the trust boundary here, replacing
-- Paystack's webhook for this one path — deliberately scoped to table
-- orders only, never counter (per spec).

CREATE FUNCTION app.create_cash_order(
  p_tenant_id uuid,
  p_table_id uuid,
  p_customer_phone text,
  p_items jsonb
)
RETURNS TABLE (order_id uuid, display_token text, amount_pesewas integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_order_id uuid;
  v_display_token text;
  v_item jsonb;
  v_menu_item RECORD;
  v_computed_total integer := 0;
  v_qty integer;
  v_local_ref text;
BEGIN
  IF p_table_id IS NULL THEN
    RAISE EXCEPTION 'table_id required for cash orders';
  END IF;
  IF p_customer_phone IS NULL OR p_customer_phone = '' THEN
    RAISE EXCEPTION 'customer_phone required';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'no items';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'invalid qty';
    END IF;

    SELECT id, name, station, price_pesewas, in_stock INTO v_menu_item
    FROM public.menu_items
    WHERE id = (v_item->>'menu_item_id')::uuid AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'menu_item not found';
    END IF;
    IF NOT v_menu_item.in_stock THEN
      RAISE EXCEPTION 'menu_item out of stock: %', v_menu_item.name;
    END IF;

    v_computed_total := v_computed_total + (v_menu_item.price_pesewas * v_qty);
  END LOOP;

  v_display_token := lpad((floor(random() * 10000))::text, 4, '0');
  v_local_ref := 'cash-' || gen_random_uuid()::text;

  INSERT INTO public.orders (tenant_id, payment_source, status, local_ref, amount_pesewas, table_id, station_id, customer_phone, display_token)
  VALUES (p_tenant_id, 'cash', 'pending_pay', v_local_ref, v_computed_total, p_table_id, NULL, p_customer_phone, v_display_token)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;
    SELECT id, name, station, price_pesewas INTO v_menu_item
    FROM public.menu_items WHERE id = (v_item->>'menu_item_id')::uuid;

    INSERT INTO public.order_items (tenant_id, order_id, station, status, name, qty, unit_price_pesewas, menu_item_id)
    VALUES (p_tenant_id, v_order_id, v_menu_item.station, 'pending', v_menu_item.name, v_qty, v_menu_item.price_pesewas, v_menu_item.id);
  END LOOP;

  RETURN QUERY SELECT v_order_id, v_display_token, v_computed_total;
END;
$$;

-- p_cash_amount_pesewas is what the waiter actually counted/received —
-- may differ from the order total (short cash, or a tip); recorded as-is
-- in cash_movements for shift reconciliation, while ledger_entries
-- always credits the order's actual total (never the cash amount
-- entered) so revenue accounting matches what was actually ordered.
CREATE FUNCTION app.confirm_cash_order_payment(
  p_tenant_id uuid,
  p_order_id uuid,
  p_waiter_user_id uuid,
  p_shift_id uuid,
  p_cash_amount_pesewas integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_order RECORD;
BEGIN
  SELECT id, amount_pesewas, status, payment_source, local_ref INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;
  IF v_order.payment_source <> 'cash' THEN
    RAISE EXCEPTION 'not a cash order';
  END IF;
  IF v_order.status <> 'pending_pay' THEN
    RAISE EXCEPTION 'order is not pending payment (status=%)', v_order.status;
  END IF;
  IF p_cash_amount_pesewas IS NULL OR p_cash_amount_pesewas <= 0 THEN
    RAISE EXCEPTION 'invalid cash amount';
  END IF;

  UPDATE public.orders SET status = 'paid' WHERE id = p_order_id;

  INSERT INTO public.payments (tenant_id, paystack_ref, status, amount_pesewas)
  VALUES (p_tenant_id, v_order.local_ref, 'paid', v_order.amount_pesewas);

  INSERT INTO public.ledger_entries (tenant_id, account, amount_pesewas, actor_user_id, paystack_ref)
  VALUES (p_tenant_id, 'fb_revenue', v_order.amount_pesewas, p_waiter_user_id, v_order.local_ref);

  INSERT INTO public.cash_movements (tenant_id, attributed_waiter_id, shift_id, amount_pesewas, order_id)
  VALUES (p_tenant_id, p_waiter_user_id, p_shift_id, p_cash_amount_pesewas, p_order_id);
END;
$$;
