// apps/scanner/src/login.ts
export interface DeviceSession {
  deviceId: string;
  apiKey: string;
  label: string;
  hubLanUrl: string;
}

const STORAGE_KEY = "evolveit_scanner_session";

export async function loginDoorDevice(
  deviceId: string,
  apiKey: string,
  hubLanUrl: string
): Promise<DeviceSession> {
  const res = await fetch(new URL("/login", hubLanUrl).toString(), {
    method: "POST",
    headers: { authorization: `Device ${deviceId}.${apiKey}` },
  });
  if (!res.ok) throw new Error("invalid_device_credentials");

  const data = (await res.json()) as { deviceId: string; label: string; role: string };
  if (data.role !== "door") throw new Error("wrong_role");

  const session: DeviceSession = { deviceId, apiKey, label: data.label, hubLanUrl };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function getStoredSession(): DeviceSession | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as DeviceSession) : null;
}