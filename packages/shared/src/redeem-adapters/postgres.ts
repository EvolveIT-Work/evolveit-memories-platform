import { decryptTotpSecret, ensure256BitKey } from '../crypto';
import type { RedeemAdapter, TicketRecord } from '../redeem';

export type PostgresLikeClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * platformKey: the 32-byte AES-256-GCM platform key (same key used by
 * paystack-webhook to encrypt totp_secret_enc at issuance). Required to
 * decrypt tickets.totp_secret_enc (base64 text column) into the raw
 * secret bytes redeemTicket() needs. Never returns ciphertext.
 */
export function createPostgresRedeemAdapter(client: PostgresLikeClient, platformKey: Buffer): RedeemAdapter {
  const key = ensure256BitKey(platformKey);

  return {
    async getTicket(ticketId: string): Promise<TicketRecord | null> {
      // tickets has no holder_name/ticket_type columns (Section 10) — join
      // users.display_name and ticket_types.name.
      const result = await client.query(
        `SELECT t.id, t.event_id, t.status, u.display_name AS holder_name,
                tt.name AS ticket_type, t.totp_secret_enc AS totp_secret_enc
         FROM tickets t
         JOIN users u ON u.id = t.buyer_user_id
         JOIN ticket_types tt ON tt.id = t.ticket_type_id
         WHERE t.id = $1`,
        [ticketId],
      );

      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        return null;
      }

      let totp_secret: Buffer | undefined;
      const encColumn = row.totp_secret_enc;
      if (typeof encColumn === 'string' && encColumn.length > 0) {
        try {
          totp_secret = decryptTotpSecret(Buffer.from(encColumn, 'base64'), key);
        } catch {
          // Corrupt/undecryptable ciphertext fails closed: redeemTicket treats
          // a missing secret as invalid_code, never as raw ciphertext.
          totp_secret = undefined;
        }
      }

      return {
        id: String(row.id ?? ''),
        event_id: String(row.event_id ?? ''),
        status: String(row.status ?? 'issued') as TicketRecord['status'],
        holder_name: String(row.holder_name ?? ''),
        ticket_type: String(row.ticket_type ?? ''),
        totp_secret,
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
      // ticket_redemptions (Section 10) is only (ticket_id, tenant_id,
      // device_id, redeemed_at) — no scanned_by/door_label columns exist on
      // the cloud table (those are hub-local cache convenience fields).
      // tenant_id is pulled from tickets in the same statement so callers
      // don't need to supply it separately.
      const result = await client.query(
        `INSERT INTO ticket_redemptions (ticket_id, tenant_id, device_id)
         SELECT $1, tenant_id, $2 FROM tickets WHERE id = $1
         ON CONFLICT (ticket_id) DO NOTHING
         RETURNING ticket_id`,
        [args.ticketId, args.deviceId],
      );

      if (result.rows.length > 0) {
        await client.query(
          `UPDATE tickets SET status = 'used' WHERE id = $1 AND status = 'issued'`,
          [args.ticketId],
        );

        return { admitted: true };
      }

      const existingResult = await client.query(
        `SELECT redeemed_at FROM ticket_redemptions WHERE ticket_id = $1 LIMIT 1`,
        [args.ticketId],
      );

      const existingRow = existingResult.rows[0] as Record<string, unknown> | undefined;
      return {
        admitted: false,
        existing: {
          scannedAt: existingRow?.redeemed_at ? String(existingRow.redeemed_at) : new Date(0).toISOString(),
          doorLabel: null,
        },
      };
    },
  };
}
