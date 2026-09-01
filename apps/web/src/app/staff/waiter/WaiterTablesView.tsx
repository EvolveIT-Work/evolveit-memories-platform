"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface WaiterTable {
  id: string;
  label: string;
  zone: string;
  waiterUserId: string | null;
  waiterName: string | null;
  activeOrderCount: number;
  status: "grey" | "yellow" | "green";
}

const STATUS_COLOR: Record<WaiterTable["status"], string> = {
  grey: "var(--ev-text-muted)",
  yellow: "var(--ev-warning)",
  green: "var(--ev-success)",
};

export default function WaiterTablesView({ isManager }: { isManager: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tables, setTables] = useState<WaiterTable[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/v1/waiter/tables")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((body) => setTables(body.tables ?? []))
      .catch((err) => setLoadError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function claim(tableId: string) {
    setClaiming(tableId);
    try {
      const res = await fetch(`/api/v1/waiter/tables/${tableId}/claim`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      router.push(`/staff/waiter/${tableId}`);
    } catch (err) {
      setLoadError(String((err as Error).message ?? err));
      setClaiming(null);
    }
  }

  return (
    <div className="staff-shell">
      <header className="staff-header">EvolveIT · {isManager ? "All Tables" : "My Tables"}</header>
      <main className="card waiter-tables-card">
        {loading && <p className="muted">Loading tables…</p>}
        {loadError && <p className="field-error">{loadError}</p>}
        {!loading && !loadError && tables.length === 0 && <p className="muted">No tables yet.</p>}
        <ul className="waiter-table-list">
          {tables.map((t) => {
            const unclaimed = !t.waiterUserId;
            return (
              <li key={t.id} className="waiter-table-row">
                <button
                  type="button"
                  className="waiter-table-row-main"
                  onClick={() => (unclaimed && !isManager ? claim(t.id) : router.push(`/staff/waiter/${t.id}`))}
                  disabled={claiming === t.id}
                >
                  <span className="waiter-status-dot" style={{ background: STATUS_COLOR[t.status] }} />
                  <span className="waiter-table-label">{t.label}</span>
                  <span className="muted">{t.zone}</span>
                  <span className="waiter-table-meta">
                    {t.activeOrderCount} order{t.activeOrderCount === 1 ? "" : "s"}
                    {isManager && (
                      <span className="muted"> · {t.waiterName ?? "unassigned"}</span>
                    )}
                    {!isManager && unclaimed && <span className="waiter-claim-hint"> · tap to claim</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
