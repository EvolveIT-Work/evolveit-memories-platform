// apps/bar-display/src/api.ts
import type { DeviceSession } from "./login";

export interface QueueItem {
  id: string;
  name: string;
  qty: number;
  status: string;
}

export interface QueueOrder {
  orderId: string;
  displayToken: string;
  createdAt: string;
  tableLabel: string | null;
  items: QueueItem[];
}

export async function fetchQueue(session: DeviceSession): Promise<{ orders: QueueOrder[]; degraded: boolean }> {
  try {
    const res = await fetch(new URL("/api/v1/orders/queue", session.platformUrl).toString(), {
      headers: { authorization: `Device ${session.deviceId}.${session.apiKey}` },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return { orders: [], degraded: true };
    const body = (await res.json()) as { orders: QueueOrder[] };
    return { orders: body.orders, degraded: false };
  } catch {
    // Section 04 fallback language: "shows its last known queue from the
    // cached state... Staff are notified of the degraded state with a
    // banner, not a blocking error." Caller keeps the last-rendered
    // queue on screen and just raises the banner.
    return { orders: [], degraded: true };
  }
}

export async function markItemReady(session: DeviceSession, itemId: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(`/api/v1/orders/items/${itemId}/ready`, session.platformUrl).toString(), {
      method: "POST",
      headers: { authorization: `Device ${session.deviceId}.${session.apiKey}` },
      signal: AbortSignal.timeout(6_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
