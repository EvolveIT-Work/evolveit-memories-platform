import argon2 from "argon2";
import type Database from "better-sqlite3";

export interface HubDeviceRow {
  id: string;
  role: string;
  label: string;
  credential_hash: string;
  revoked: number;
}

/** Mirrors apps/web/src/app/api/v1/hub/hello/route.ts's parseDeviceAuth. */
export function parseDeviceAuthHeader(header: string | null | undefined): { deviceId: string; apiKey: string } | null {
  if (!header) return null;
  const [scheme, rest] = header.split(" ");
  if (scheme !== "Device" || !rest) return null;
  const [deviceId, apiKey] = rest.split(".");
  if (!deviceId || !apiKey) return null;
  return { deviceId, apiKey };
}

/** Verifies a door device against the hub's local cache — works offline. */
export async function verifyDoorDevice(
  db: Database.Database,
  header: string | null | undefined,
): Promise<HubDeviceRow | null> {
  const parsed = parseDeviceAuthHeader(header);
  if (!parsed) return null;

  const row = db
    .prepare(`SELECT id, role, label, credential_hash, revoked FROM devices WHERE id = ?`)
    .get(parsed.deviceId) as HubDeviceRow | undefined;

  if (!row || row.revoked || row.role !== "door") return null;

  const ok = await argon2.verify(row.credential_hash, parsed.apiKey);
  return ok ? row : null;
}