// apps/bar-display/src/login.ts
export interface DeviceSession {
  deviceId: string;
  apiKey: string;
  platformUrl: string;
  role: "bar_display" | "kitchen_display";
}

const STORAGE_KEY = "evolveit_display_session";

export async function loginDisplayDevice(deviceId: string, apiKey: string, platformUrl: string): Promise<DeviceSession> {
  // No dedicated /login endpoint for this role — the queue endpoint
  // itself is device-authenticated, so calling it once at sign-in both
  // verifies credentials and confirms the role. queue/route.ts rejects
  // anything that isn't bar_display/kitchen_display.
  const res = await fetch(new URL("/api/v1/orders/queue", platformUrl).toString(), {
    headers: { authorization: `Device ${deviceId}.${apiKey}` },
  });
  if (res.status === 401) throw new Error("invalid_device_credentials");
  if (res.status === 403) throw new Error("wrong_role");
  if (!res.ok) throw new Error("login_failed");

  // Role isn't returned by the queue endpoint (it doesn't need to be —
  // the server already enforced it), but this display doesn't need to
  // know which one it is either; the server-side station filtering is
  // what matters. Store a placeholder; only used for the header label.
  const session: DeviceSession = { deviceId, apiKey, platformUrl, role: "bar_display" };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function getStoredSession(): DeviceSession | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as DeviceSession) : null;
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
