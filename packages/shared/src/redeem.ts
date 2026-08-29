import { verifyTotpCode } from './totp';

export interface RedeemInput {
  ticketId: string;
  totpCode: string;
  deviceId: string;
  scannedBy?: string;
  doorLabel?: string;
}

export interface TicketRecord {
  id: string;
  event_id: string;
  status: 'issued' | 'used' | 'voided' | 'reserved';
  holder_name: string;
  ticket_type: string;
  /**
   * Decrypted, raw-byte TOTP secret. Adapters must always decrypt before
   * returning a TicketRecord — never hand back ciphertext here. Undefined
   * means the ticket has no usable secret (verification fails closed).
   */
  totp_secret?: Buffer;
}

export type RedeemResult =
  | { outcome: 'admit'; holderName: string; ticketType: string }
  | { outcome: 'already_used'; scannedAt: string; doorLabel: string | null }
  | { outcome: 'not_valid'; reason: 'voided' | 'expired' | 'wrong_event' }
  | { outcome: 'invalid_code' };

export interface RedeemAdapter {
  getTicket(ticketId: string): Promise<TicketRecord | null>;
  getRevocation(ticketId: string): Promise<boolean>;
  getDeviceScope(deviceId: string): Promise<{ eventIds: string[]; revoked: boolean }>;
  tryRedeem(args: {
    ticketId: string;
    deviceId: string;
    scannedBy?: string;
    doorLabel?: string;
  }): Promise<{ admitted: boolean; existing?: { scannedAt: string; doorLabel: string | null } }>;
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function redeemTicket(input: RedeemInput, adapter: RedeemAdapter): Promise<RedeemResult> {
  const ticketId = input.ticketId?.trim();
  const totpCode = input.totpCode?.trim();
  if (!ticketId || !isValidUuid(ticketId) || !/^\d{6}$/.test(totpCode ?? '')) {
    return { outcome: 'invalid_code' };
  }

  const deviceScope = await adapter.getDeviceScope(input.deviceId);
  if (deviceScope.revoked) {
    return { outcome: 'not_valid', reason: 'wrong_event' };
  }

  const ticket = await adapter.getTicket(ticketId);
  if (!ticket) {
    return { outcome: 'not_valid', reason: 'voided' };
  }

  if (ticket.status === 'voided') {
    return { outcome: 'not_valid', reason: 'voided' };
  }

  if (ticket.status === 'reserved') {
    return { outcome: 'not_valid', reason: 'expired' };
  }

  if (ticket.event_id && !deviceScope.eventIds.includes(ticket.event_id)) {
    return { outcome: 'not_valid', reason: 'wrong_event' };
  }

  const revocationIsPresent = await adapter.getRevocation(ticketId);
  if (revocationIsPresent) {
    return { outcome: 'not_valid', reason: 'voided' };
  }

  if (!(ticket.totp_secret instanceof Buffer) || ticket.totp_secret.length === 0) {
    return { outcome: 'invalid_code' };
  }
  if (!verifyTotpCode(ticket.totp_secret, totpCode, Date.now(), 1)) {
    return { outcome: 'invalid_code' };
  }

  const result = await adapter.tryRedeem({
    ticketId,
    deviceId: input.deviceId,
    scannedBy: input.scannedBy,
    doorLabel: input.doorLabel,
  });

  if (result.admitted) {
    return { outcome: 'admit', holderName: ticket.holder_name, ticketType: ticket.ticket_type };
  }

  if (result.existing) {
    return {
      outcome: 'already_used',
      scannedAt: result.existing.scannedAt,
      doorLabel: result.existing.doorLabel ?? null,
    };
  }

  return { outcome: 'invalid_code' };
}
