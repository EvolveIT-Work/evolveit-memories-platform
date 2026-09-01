"use client";

import { useEffect, useState } from "react";

// Landing page after Paystack redirects back. Payment confirmation is
// async — the actual order only exists once paystack-webhook has run,
// which may land a second or two after this page loads (or, per spec's
// own resilience principle for tickets, even after this browser tab is
// closed). Poll rather than assume.

type OrderStatus = "pending" | "pending_pay" | "paid" | "preparing" | "ready" | "complete" | "voided";

interface StatusResponse {
  status: OrderStatus;
  display_token?: string;
  amount_pesewas?: number;
}

function formatGhs(pesewas: number): string {
  return `GH₵${(pesewas / 100).toFixed(2)}`;
}

export default function OrderStatusPage() {
  const [result, setResult] = useState<StatusResponse | null>(null);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reference = params.get("reference") ?? params.get("trxref");
    if (!reference) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const res = await fetch(`/api/order/status?reference=${encodeURIComponent(reference!)}`);
      const body = (await res.json()) as StatusResponse;
      if (cancelled) return;

      setResult(body);
      setAttempts((n) => n + 1);

      if (body.status === "pending") {
        timer = setTimeout(poll, 1500);
      } else if (body.status === "pending_pay") {
        // Cash order: waiting on the waiter's Cash Received tap, which
        // could be minutes away — poll less aggressively than the
        // webhook-wait case above.
        timer = setTimeout(poll, 5000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (!result || result.status === "pending") {
    return (
      <div className="order-shell order-state">
        <div className="order-confirm-spinner" />
        <p>Confirming your payment…</p>
        {attempts > 6 && (
          <p className="muted">This is taking longer than usual — hold on, your order won&rsquo;t be lost.</p>
        )}
      </div>
    );
  }

  if (result.status === "voided") {
    return <div className="order-shell order-state order-error">This order was voided. Contact a staff member.</div>;
  }

  if (result.status === "pending_pay") {
    // Per construction (api/order/status), a 'pending_pay' row can only
    // be a cash order — create_order_for_payment (MoMo) always inserts
    // rows already 'paid', so no MoMo order is ever visible in this
    // state. Continues polling above until the waiter confirms.
    return (
      <div className="order-shell order-state order-cash-pending">
        <div className="order-confirm-kicker">Order placed</div>
        <div className="order-confirm-token">{result.display_token}</div>
        {typeof result.amount_pesewas === "number" && (
          <p className="order-confirm-amount">Pay {formatGhs(result.amount_pesewas)} in cash to your waiter</p>
        )}
        <p className="muted">Your order will be sent to the bar/kitchen once the waiter confirms payment.</p>
      </div>
    );
  }

  return (
    <div className="order-shell order-state order-confirmed">
      <div className="order-confirm-kicker">Order confirmed</div>
      <div className="order-confirm-token">{result.display_token}</div>
      <p className="muted">Show this number when you collect your order.</p>
      {typeof result.amount_pesewas === "number" && <p className="order-confirm-amount">{formatGhs(result.amount_pesewas)}</p>}
    </div>
  );
}
