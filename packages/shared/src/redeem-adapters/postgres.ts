import type { RedeemAdapter, TicketRecord } from '../redeem';

export type PostgresLikeClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export function createPostgresRedeemAdapter(client: PostgresLikeClient): RedeemAdapter {
  return {
    async getTicket(ticketId: string): Promise<TicketRecord | null> {
      const result = await client.query(
        `SELECT id, event_id, status, holder_name, ticket_type, totp_secret_enc AS totp_secret_enc FROM tickets WHERE id = $1`,
        [ticketId],
      );

      const row = result.rows[0] as Record<string, unknown> | undefined;
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
      const result = await client.query(`SELECT 1 FROM revocations WHERE ticket_id = $1 LIMIT 1`, [ticketId]);
      return result.rows.length > 0;
    },

    async getDeviceScope(deviceId: string): Promise<{ eventIds: string[]; revoked: boolean }> {
      const result = await client.query(
        `SELECT event_ids, revoked_at IS NOT NULL AS revoked FROM devices WHERE id = $1 LIMIT 1`,
        [deviceId],
      );

      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        return { eventIds: [], revoked: true };
      }

      const eventIds = Array.isArray(row.event_ids) ? row.event_ids.map((value) => String(value)) : [];
      return {
        eventIds,
        revoked: Boolean(row.revoked),
      };
    },

    async tryRedeem(args): Promise<{ admitted: boolean; existing?: { scannedAt: string; doorLabel: string | null } }> {
      const result = await client.query(
        `INSERT INTO ticket_redemptions (ticket_id, device_id, scanned_by, door_label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (ticket_id) DO NOTHING
         RETURNING ticket_id`,
        [args.ticketId, args.deviceId, args.scannedBy ?? null, args.doorLabel ?? null],
      );

      if (result.rows.length > 0) {
        await client.query(
          `UPDATE tickets SET status = 'used' WHERE id = $1 AND status = 'issued'`,
          [args.ticketId],
        );

        return { admitted: true };
      }

      const existingResult = await client.query(
        `SELECT scanned_at, door_label FROM ticket_redemptions WHERE ticket_id = $1 LIMIT 1`,
        [args.ticketId],
      );

      const existingRow = existingResult.rows[0] as Record<string, unknown> | undefined;
      return {
        admitted: false,
        existing: {
          scannedAt: existingRow?.scanned_at ? String(existingRow.scanned_at) : new Date(0).toISOString(),
          doorLabel: existingRow?.door_label ? String(existingRow.door_label) : null,
        },
      };
    },
  };
}
