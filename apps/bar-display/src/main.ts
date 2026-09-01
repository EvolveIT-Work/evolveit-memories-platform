// apps/bar-display/src/main.ts
import { loginDisplayDevice, getStoredSession, clearSession, type DeviceSession } from "./login";
import { fetchQueue, markItemReady, type QueueOrder } from "./api";

const POLL_INTERVAL_MS = 4_000; // spec's own documented fallback cadence — see queue/route.ts comment

const loginScreen = document.getElementById("login-screen")!;
const queueScreen = document.getElementById("queue-screen")!;
const queueTitle = document.getElementById("queue-title")!;
const queueBanner = document.getElementById("queue-banner")!;
const queueGrid = document.getElementById("queue-grid")!;
const loginBtn = document.getElementById("login-btn") as HTMLButtonElement;
const loginError = document.getElementById("login-error")!;

let session: DeviceSession | null = null;
let lastGoodOrders: QueueOrder[] = [];

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function renderOrders(orders: QueueOrder[]) {
  queueGrid.innerHTML = "";
  if (orders.length === 0) {
    queueGrid.innerHTML = `<div class="queue-empty">No active orders</div>`;
    return;
  }

  for (const order of orders) {
    const card = document.createElement("div");
    card.className = "order-card";

    const header = document.createElement("div");
    header.className = "order-card-header";
    header.innerHTML = `
      <span class="order-card-token">${order.displayToken}</span>
      <span class="order-card-meta">${formatHHMM(order.createdAt)}${order.tableLabel ? ` · ${order.tableLabel}` : ""}</span>
    `;
    card.appendChild(header);

    const itemList = document.createElement("div");
    itemList.className = "order-card-items";
    for (const item of order.items) {
      const row = document.createElement("div");
      row.className = "order-card-item" + (item.status === "ready" ? " item-ready" : "");
      row.innerHTML = `
        <span class="item-qty">${item.qty}×</span>
        <span class="item-name">${item.name}</span>
        <button class="item-ready-btn" ${item.status === "ready" ? "disabled" : ""} data-item-id="${item.id}">
          ${item.status === "ready" ? "READY ✓" : "READY"}
        </button>
      `;
      itemList.appendChild(row);
    }
    card.appendChild(itemList);
    queueGrid.appendChild(card);
  }

  queueGrid.querySelectorAll<HTMLButtonElement>(".item-ready-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!session) return;
      btn.disabled = true;
      btn.textContent = "…";
      const ok = await markItemReady(session, btn.dataset.itemId!);
      if (!ok) {
        btn.disabled = false;
        btn.textContent = "READY";
        return;
      }
      // Optimistic: rely on the next poll to fully reconcile (including
      // removing the card once the whole order flips to 'ready').
      pollOnce();
    });
  });
}

async function pollOnce() {
  if (!session) return;
  const { orders, degraded } = await fetchQueue(session);
  queueBanner.classList.toggle("hidden", !degraded);
  if (degraded) {
    queueBanner.textContent = "Connection lost — showing last known queue";
    renderOrders(lastGoodOrders);
  } else {
    lastGoodOrders = orders;
    renderOrders(orders);
  }
}

function startPolling() {
  pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

loginBtn.addEventListener("click", async () => {
  loginError.textContent = "";
  const deviceId = (document.getElementById("device-id") as HTMLInputElement).value.trim();
  const apiKey = (document.getElementById("api-key") as HTMLInputElement).value.trim();
  const platformUrl = (document.getElementById("platform-url") as HTMLInputElement).value.trim();

  try {
    session = await loginDisplayDevice(deviceId, apiKey, platformUrl);
    loginScreen.classList.add("hidden");
    queueScreen.classList.remove("hidden");
    queueTitle.textContent = "Order Queue";
    startPolling();
  } catch (err) {
    loginError.textContent = (err as Error).message ?? "Sign-in failed";
  }
});

const stored = getStoredSession();
if (stored) {
  session = stored;
  loginScreen.classList.add("hidden");
  queueScreen.classList.remove("hidden");
  queueTitle.textContent = "Order Queue";
  startPolling();
}

// Kiosk mode has no explicit sign-out button in the UI per spec (staff
// don't interact with auth once mounted); clearSession is exported for
// manual use via devtools if a device needs to be re-paired.
void clearSession;
