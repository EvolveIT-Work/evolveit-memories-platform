"use client";

import { useEffect, useMemo, useState } from "react";

// Shared cart/checkout UI for both /order/table/[qrToken] and
// /order/counter/[stationCode] — Section 04 says these are "identical
// in mechanism", differing only in what happens after checkout (customer
// collects at counter vs waiter delivers at table), which this component
// doesn't need to know about.

interface MenuItem {
  id: string;
  name: string;
  station: "bar" | "kitchen";
  price_pesewas: number;
}

function formatGhs(pesewas: number): string {
  return `GH₵${(pesewas / 100).toFixed(2)}`;
}

export default function OrderMenu({ context, token }: { context: "table" | "counter"; token: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targetLabel, setTargetLabel] = useState("");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState<"momo" | "cash" | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/order/menu?context=${context}&token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((body) => {
        setTargetLabel(body.targetLabel ?? "");
        setItems(body.items ?? []);
      })
      .catch((err) => setLoadError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }, [context, token]);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (cart[item.id] ?? 0) * item.price_pesewas, 0),
    [items, cart],
  );
  const itemCount = useMemo(() => Object.values(cart).reduce((a, b) => a + b, 0), [cart]);

  function setQty(itemId: string, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[itemId];
      else next[itemId] = qty;
      return next;
    });
  }

  async function checkoutMomo() {
    setSubmitError(null);
    if (itemCount === 0) {
      setSubmitError("Add at least one item first.");
      return;
    }
    if (phone.trim().length < 6) {
      setSubmitError("Enter a valid phone number.");
      return;
    }

    setSubmitting("momo");
    try {
      const res = await fetch("/api/order/start-payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          context,
          token,
          customer_phone: phone.trim(),
          items: Object.entries(cart).map(([menu_item_id, qty]) => ({ menu_item_id, qty })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.href = body.authorization_url;
    } catch (err) {
      setSubmitError(String((err as Error).message ?? err));
      setSubmitting(null);
    }
  }

  // Table-only (Section 04 "This applies only to table service, not
  // counter bar orders"). No Paystack redirect — the order is created
  // immediately (pending_pay); the waiter's Cash Received tap is the
  // actual payment confirmation, not this request.
  async function checkoutCash() {
    setSubmitError(null);
    if (itemCount === 0) {
      setSubmitError("Add at least one item first.");
      return;
    }
    if (phone.trim().length < 6) {
      setSubmitError("Enter a valid phone number.");
      return;
    }

    setSubmitting("cash");
    try {
      const res = await fetch("/api/order/start-cash-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          customer_phone: phone.trim(),
          items: Object.entries(cart).map(([menu_item_id, qty]) => ({ menu_item_id, qty })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      window.location.href = `/order/status?order_id=${encodeURIComponent(body.order_id)}`;
    } catch (err) {
      setSubmitError(String((err as Error).message ?? err));
      setSubmitting(null);
    }
  }

  if (loading) return <div className="order-shell order-state">Loading menu…</div>;
  if (loadError) return <div className="order-shell order-state order-error">{loadError}</div>;

  return (
    <div className="order-shell">
      <header className="order-header">
        <div className="order-header-kicker">{context === "table" ? "Table Order" : "Counter Order"}</div>
        <h1>{targetLabel}</h1>
      </header>

      <ul className="order-menu-list">
        {items.length === 0 && <li className="muted">Nothing available right now.</li>}
        {items.map((item) => {
          const qty = cart[item.id] ?? 0;
          return (
            <li key={item.id} className="order-menu-item">
              <div className="order-menu-item-info">
                <div className="order-menu-item-name">{item.name}</div>
                <div className="order-menu-item-price">{formatGhs(item.price_pesewas)}</div>
              </div>
              <div className="order-qty-stepper">
                <button type="button" onClick={() => setQty(item.id, qty - 1)} disabled={qty === 0} aria-label={`Remove one ${item.name}`}>
                  −
                </button>
                <span>{qty}</span>
                <button type="button" onClick={() => setQty(item.id, qty + 1)} aria-label={`Add one ${item.name}`}>
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="order-checkout-bar">
        <label htmlFor="order-phone">Phone number</label>
        <input
          id="order-phone"
          type="tel"
          placeholder="0XX XXX XXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <div className="order-total-row">
          <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
          <span className="order-total-amount">{formatGhs(total)}</span>
        </div>
        {submitError && <div className="field-error">{submitError}</div>}
        <button type="button" className="btn-momo" onClick={checkoutMomo} disabled={submitting !== null || itemCount === 0}>
          {submitting === "momo" ? "Starting payment…" : "Pay with MoMo"}
        </button>
        {context === "table" && (
          <button type="button" className="btn-cash" onClick={checkoutCash} disabled={submitting !== null || itemCount === 0}>
            {submitting === "cash" ? "Placing order…" : "Pay with Cash (waiter collects)"}
          </button>
        )}
      </div>
    </div>
  );
}
