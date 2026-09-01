-- 0020_order_display_token
-- Section 04: bar/kitchen display shows "the order token number (a
-- 4-digit number displayed large for the customer to reference)".
-- Nothing in the schema carries this — adding it, generated at order
-- creation time.

ALTER TABLE public.orders
  ADD COLUMN display_token text;

-- Backfill is a no-op today (0019 shipped in the same sprint, no real
-- orders exist yet), but written for correctness if ever run against a
-- database with existing rows.
UPDATE public.orders
SET display_token = lpad((floor(random() * 10000))::text, 4, '0')
WHERE display_token IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN display_token SET NOT NULL;
