-- 0019_create_order_for_payment
-- Mirrors app.issue_tickets_for_payment's pattern exactly: nothing is
-- written until payment is confirmed (no orders/order_items exist
-- pre-payment — bar/kitchen displays only ever see paid orders, which is
-- the entire anti-fraud guarantee of Section 04 "no payment confirmation
-- button on the bar display"). Server recomputes the total from
-- menu_items.price_pesewas — the client-submitted amount is never
-- trusted, exactly like issue_tickets_for_payment checks
-- unit_price * qty.

CREATE OR REPLACE FUNCTION app.create_order_for_payment(
  p_tenant_id uuid,
  p_table_id uuid,
  p_station_id uuid,
  p_customer_phone text,
  p_paystack_ref text,
  p_items jsonb,
  p_amount_pesewas integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app, pg_temp
AS $$
DECLARE
  v_order_id uuid;
  v_payment_id uuid;
  v_item jsonb;
  v_menu_item RECORD;
  v_computed_total integer := 0;
  v_qty integer;
BEGIN
  IF (p_table_id IS NULL) = (p_station_id IS NULL) THEN
    RAISE EXCEPTION 'exactly one of table_id/station_id required';
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

  IF p_amount_pesewas IS DISTINCT FROM v_computed_total THEN
    RAISE EXCEPTION 'amount_mismatch_expected_%', v_computed_total;
  END IF;

  INSERT INTO public.payments (tenant_id, paystack_ref, status, amount_pesewas)
  VALUES (p_tenant_id, p_paystack_ref, 'paid', p_amount_pesewas)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.orders (tenant_id, payment_source, status, local_ref, amount_pesewas, table_id, station_id, customer_phone)
  VALUES (p_tenant_id, 'momo', 'paid', p_paystack_ref, p_amount_pesewas, p_table_id, p_station_id, p_customer_phone)
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;

    SELECT id, name, station, price_pesewas INTO v_menu_item
    FROM public.menu_items WHERE id = (v_item->>'menu_item_id')::uuid;

    INSERT INTO public.order_items (tenant_id, order_id, station, status, name, qty, unit_price_pesewas, menu_item_id)
    VALUES (p_tenant_id, v_order_id, v_menu_item.station, 'pending', v_menu_item.name, v_qty, v_menu_item.price_pesewas, v_menu_item.id);
  END LOOP;

  INSERT INTO public.ledger_entries (tenant_id, account, amount_pesewas, paystack_ref)
  VALUES (p_tenant_id, 'fb_revenue', p_amount_pesewas, p_paystack_ref);

  RETURN v_order_id;
END;
$$;
