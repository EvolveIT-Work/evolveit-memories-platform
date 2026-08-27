import type { RedeemAdapter, TicketRecord } from '../redeem';

export type SqliteLikeDb = {
  prepare: (sql: string) => {
    get: (...params: unknown[]) => Record<string, unknown> | undefined;
    run: (...params: unknown[]) => { changes: number };
    all: (...params: unknown[]) => Record<string, unknown>[];
  };
  transaction?: <T>(callback: () => T) => T;
};

export function createSqliteRedeemAdapter(db: SqliteLikeDb): RedeemAdapter {
  return {
    async getTicket(ticketId: string): Promise<TicketRecord | null> {
      const row = db.prepare(
        `SELECT id, event_id, status, holder_name, ticket_type, totp_secret_enc AS totp_secret_enc FROM tickets_cache WHERE id = ?`,
      ).get(ticketId) as Record<string, unknown> | undefined;

      if (!row) {
        return null;
      }

      return {
        id: String(row.id ?? ''),
        event_id: String(row.event_id ?? ''),
        status: String(row.status ?? 'issued') as TicketRecord['status'],
        holder_name: String(row.holder_name ?? ''),
        ticket_type: String(row.ticket_type ?? ''),
        totp_secret_enc: row.totp_secret_enc as string | Buffer | undefined,
      };
    },

    async getRevocation(ticketId: string): Promise<boolean> {
      const row = db.prepare(`SELECT 1 FROM revocations_cache WHERE ticket_id = ? LIMIT 1`).get(ticketId);
      return Boolean(row);
    },

    async getDeviceScope(deviceId: string): Promise<{ eventIds: string[]; revoked: boolean }> {
      const row = db.prepare(`SELECT event_ids, revoked FROM devices WHERE id = ? LIMIT 1`).get(deviceId) as Record<string, unknown> | undefined;
      if (!row) {
        return { eventIds: [], revoked: true };
      }

      const eventIds = Array.isArray(row.event_ids) ? row.event_ids.map((value) => String(value)) : [];
      return { eventIds, revoked: Boolean(row.revoked) };
    },

    async tryRedeem(args): Promise<{ admitted: boolean; existing?: { scannedAt: string; doorLabel: string | null } }> {
      const execute = db.transaction ? db.transaction.bind(db) : <T>(callback: () => T) => callback();

      const attempt = execute(() => {
        const insert = db.prepare(
          `INSERT INTO redemptions_local (ticket_id, device_id, scanned_by, door_label) VALUES (?, ?, ?, ?)
           ON CONFLICT(ticket_id) DO NOTHING`,
        );
        const insertResult = insert.run(args.ticketId, args.deviceId, args.scannedBy ?? null, args.doorLabel ?? null) as { changes: number };

        if (insertResult.changes > 0) {
          db.prepare(`UPDATE tickets_cache SET status = 'used' WHERE id = ? AND status = 'issued'`).run(args.ticketId);
          return { admitted: true } as const;
        }

        const existing = db.prepare(`SELECT scanned_at, door_label FROM redemptions_local WHERE ticket_id = ? LIMIT 1`).get(args.ticketId) as
          | Record<string, unknown>
          | undefined;

        return {
          admitted: false,
          existing: {
            scannedAt: existing?.scanned_at ? String(existing.scanned_at) : new Date(0).toISOString(),
            doorLabel: existing?.door_label ? String(existing.door_label) : null,
          },
        } as const;
      });

      return attempt;
    },
  };
}
