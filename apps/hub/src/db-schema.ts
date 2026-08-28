import type Database from "better-sqlite3";

/**
 * CAS tables consumed by createSqliteRedeemAdapter() in
 * packages/shared/src/redeem-adapters/sqlite.ts. Column names here must
 * match that adapter's SQL exactly.
 */
export function applyCasSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tickets_cache (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      holder_name TEXT NOT NULL,
      ticket_type TEXT NOT NULL,
      totp_secret_enc TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revocations_cache (
      ticket_id TEXT PRIMARY KEY
    );

    -- Synced from cloud "devices". Note: the shared adapter's
    -- getDeviceScope() does Array.isArray(row.event_ids), which is always
    -- false for a TEXT column — pre-existing behaviour in packages/shared,
    -- unchanged here.
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      role TEXT NOT NULL,
      label TEXT NOT NULL,
      credential_hash TEXT NOT NULL,
      event_ids TEXT NOT NULL DEFAULT '[]',
      revoked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS redemptions_local (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id TEXT NOT NULL UNIQUE,
      device_id TEXT,
      scanned_by TEXT,
      door_label TEXT,
      scanned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      synced INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_redemptions_local_synced ON redemptions_local(synced);
  `);
}