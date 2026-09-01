"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface OrderItemView {
  id: string;
  name: string;
  qty: number;
  status: string;
}

interface OrderView {
  id: string;
  displayToken: string;
  paymentSource: string;
  status: string;
  amountPesewas: number;
  createdAt: string;
  needsCashConfirmation: boolean;
  items: OrderItemView[];
}

interface TableDetail {
  table: { id: string; label: string; zone: string };
  orders: OrderView[];
}

function formatGhs(pesewas: number): string {
  return `GH₵${(pesewas / 100).toFixed(2)}`;
}

export default function WaiterTableDetail({ tableId }: { tableId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [cashInputs, setCashInputs] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    setForbidden(false);
    fetch(`/api/v1/waiter/tables/${tableId}`)
      .then(async (res) => {
        if (res.status === 403) {
          setForbidden(true);
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((body) => {
        if (!body) return;
        setDetail(body);
        setCashInputs((prev) => {
          const next = { ...prev };
          for (const o of body.orders as OrderView[]) {
            if (o.needsCashConfirmation && next[o.id] === undefined) {
              next[o.id] = (o.amountPesewas / 100).toFixed(2);
            }
          }
          return next;
        });
      })
      .catch((err) => setLoadError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }, [tableId]);

  useEffect(load, [load]);

  async function claimThisTable() {
    setClaiming(true);
    try {
      const res = await fetch(`/api/v1/waiter/tables/${tableId}/claim`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      load();
    } catch (err) {
      setLoadError(String((err as Error).message ?? err));
    } finally {
      setClaiming(false);
    }
  }

  async function confirmCash(orderId: string) {
    setConfirmError((prev) => ({ ...prev, [orderId]: "" }));
    const raw = cashInputs[orderId] ?? "";
    const ghs = Number(raw);
    if (!raw || !Number.isFinite(ghs) || ghs <= 0) {
      setConfirmError((prev) => ({ ...prev, [orderId]: "Enter the amount of cash received." }));
      return;
    }
    const cashAmountPesewas = Math.round(ghs * 100);

    setConfirming(orderId);
    try {
      const res = await fetch(`/api/v1/waiter/orders/${orderId}/cash-received`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cashAmountPesewas }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      load();
    } catch (err) {
      setConfirmError((prev) => ({ ...prev, [orderId]: String((err as Error).message ?? err) }));
    } finally {
      setConfirming(null);
    }
  }

  return (
    <div className="staff-shell">
      <header className="staff-header">
        <button type="button" className="waiter-back-link" onClick={() => router.push("/staff/waiter")}>
          ← Tables
        </button>
      </header>
      <main className="card waiter-detail-card">
        {loading && <p className="muted">Loading table…</p>}
        {loadError && <p className="field-error">{loadError}</p>}

        {forbidden && !loading && (
          <>
            <p className="muted">This table isn't assigned to you yet.</p>
            <button type="button" className="btn-primary" onClick={claimThisTable} disabled={claiming}>
              {claiming ? "Claiming…" : "Claim this table"}
            </button>
          </>
        )}

        {detail && (
          <>
            <h1 className="waiter-detail-title">{detail.table.label}</h1>
            <p className="muted">{detail.table.zone}</p>

            {detail.orders.length === 0 && <p className="muted">No orders yet.</p>}

            <ul className="waiter-order-list">
              {detail.orders.map((o) => (
                <li key={o.id} className="waiter-order-card">
                  <div className="waiter-order-header">
                    <span className="mono">#{o.displayToken}</span>
                    <span className={`waiter-badge waiter-badge-${o.paymentSource}`}>
                      {o.paymentSource === "cash" ? "Cash" : "MoMo"}
                    </span>
                    <span className="waiter-badge waiter-badge-status">{o.status}</span>
                    <span className="waiter-order-amount">{formatGhs(o.amountPesewas)}</span>
                  </div>
                  <ul className="waiter-item-list">
                    {o.items.map((item) => (
                      <li key={item.id} className="waiter-item-row">
                        <span>
                          {item.qty}× {item.name}
                        </span>
                        <span className="muted">{item.status}</span>
                      </li>
                    ))}
                  </ul>
                  {o.needsCashConfirmation && (
                    <div className="waiter-cash-confirm">
                      <label htmlFor={`cash-${o.id}`}>Cash received (GH₵)</label>
                      <input
                        id={`cash-${o.id}`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={cashInputs[o.id] ?? ""}
                        onChange={(e) => setCashInputs((prev) => ({ ...prev, [o.id]: e.target.value }))}
                      />
                      {confirmError[o.id] && <div className="field-error">{confirmError[o.id]}</div>}
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => confirmCash(o.id)}
                        disabled={confirming === o.id}
                      >
                        {confirming === o.id ? "Confirming…" : "Cash Received"}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
