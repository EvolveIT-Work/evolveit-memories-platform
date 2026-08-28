import type Database from "better-sqlite3";
import type pino from "pino";

export const syncState = {
  lastPullOk: false,
  lastPullAt: null as string | null,
  lastError: null as string | null,
};

interface SyncPullResponse {
  tickets: Array<{
    id: string;
    event_id: string;
    status: string;
    holder_name: string;
    ticket_type: string;
    totp_secret: string; // decrypted plaintext, sent by the cloud sync-pull endpoint
  }>;
  revocations: Array<{ ticket_id: string }>;
  devices: Array<{
    id: string;
    tenant_id: string;
    role: string;
    label: string;
    credential_hash: string;
    event_ids: string[];
    revoked: boolean;
  }>;
}

export function createSyncRunner(opts: {
  db: Database.Database;
  platformUrl: string;
  deviceAuthHeader: string;
  intervalMs?: number;
  log: pino.Logger;
}) {
  const { db, platformUrl, deviceAuthHeader, log } = opts;
  const intervalMs = opts.intervalMs ?? 60_000;

  const upsertTicket = db.prepare(`
    INSERT INTO tickets_cache (id, event_id, status, holder_name, ticket_type, totp_secret_enc)
    VALUES (@id, @event_id, @status, @holder_name, @ticket_type, @totp_secret_enc)
    ON CONFLICT(id) DO UPDATE SET
      event_id = excluded.event_id,
      status = excluded.status,
      holder_name = excluded.holder_name,
      ticket_type = excluded.ticket_type,
      totp_secret_enc = excluded.totp_secret_enc
  `);

  const upsertRevocation = db.prepare(`
    INSERT INTO revocations_cache (ticket_id) VALUES (?)
    ON CONFLICT(ticket_id) DO NOTHING
  `);

  const upsertDevice = db.prepare(`
    INSERT INTO devices (id, tenant_id, role, label, credential_hash, event_ids, revoked)
    VALUES (@id, @tenant_id, @role, @label, @credential_hash, @event_ids, @revoked)
    ON CONFLICT(id) DO UPDATE SET
      tenant_id = excluded.tenant_id,
      role = excluded.role,
      label = excluded.label,
      credential_hash = excluded.credential_hash,
      event_ids = excluded.event_ids,
      revoked = excluded.revoked
  `);

  const unsyncedRedemptions = db.prepare(`
    SELECT id, ticket_id, device_id, scanned_by, door_label, scanned_at
    FROM redemptions_local WHERE synced = 0 ORDER BY id ASC LIMIT 200
  `);

  const markSynced = db.prepare(`UPDATE redemptions_local SET synced = 1 WHERE id = ?`);

  async function pull(): Promise<void> {
    try {
      const res = await fetch(new URL("/api/v1/hub/sync-pull", platformUrl), {
        headers: { authorization: deviceAuthHeader },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`sync_pull_${res.status}`);

      const body = (await res.json()) as SyncPullResponse;

      const applyAll = db.transaction(() => {
        for (const t of body.tickets) {
          upsertTicket.run({
            id: t.id,
            event_id: t.event_id,
            status: t.status,
            holder_name: t.holder_name,
            ticket_type: t.ticket_type,
            totp_secret_enc: t.totp_secret,
          });
        }
        for (const r of body.revocations) upsertRevocation.run(r.ticket_id);
        for (const d of body.devices) {
          upsertDevice.run({
            id: d.id,
            tenant_id: d.tenant_id,
            role: d.role,
            label: d.label,
            credential_hash: d.credential_hash,
            event_ids: JSON.stringify(d.event_ids ?? []),
            revoked: d.revoked ? 1 : 0,
          });
        }
      });
      applyAll();

      syncState.lastPullOk = true;
      syncState.lastPullAt = new Date().toISOString();
      syncState.lastError = null;
    } catch (err) {
      syncState.lastPullOk = false;
      syncState.lastError = err instanceof Error ? err.message : "unknown";
      log.error({ msg: "hub_sync_pull_failed", err: syncState.lastError });
    }
  }

  async function push(): Promise<void> {
    const rows = unsyncedRedemptions.all() as Array<{
      id: number;
      ticket_id: string;
      device_id: string | null;
      scanned_by: string | null;
      door_label: string | null;
      scanned_at: string;
    }>;
    if (rows.length === 0) return;

    try {
      const res = await fetch(new URL("/api/v1/hub/sync-push", platformUrl), {
        method: "POST",
        headers: { authorization: deviceAuthHeader, "content-type": "application/json" },
        body: JSON.stringify({ redemptions: rows }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`sync_push_${res.status}`);

      const markAll = db.transaction(() => {
        for (const r of rows) markSynced.run(r.id);
      });
      markAll();
    } catch (err) {
      log.error({ msg: "hub_sync_push_failed", err: err instanceof Error ? err.message : "unknown" });
    }
  }

  function start(): void {
    pull();
    push();
    setInterval(pull, intervalMs);
    setInterval(push, intervalMs);
  }

  return { start, pull, push };
}