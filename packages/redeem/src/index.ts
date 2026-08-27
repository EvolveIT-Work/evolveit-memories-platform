/**
 * Single redeem_ticket module for hub and cloud (Appendix B prohibition 8).
 * Day 2 implements CAS + TOTP + revocation. Do not add a second copy.
 */
export type RedeemInput = {
  ticket_uuid: string;
  totp_code: string;
};

export type RedeemResult =
  | { ok: true; holder_name: string }
  | { ok: false; reason: "NOT_VALID" | "ALREADY_USED" | "REVOKED" | "WINDOW" };

export async function redeemTicket(_input: RedeemInput): Promise<RedeemResult> {
  throw new Error("redeem_ticket is Day 2. Hub and cloud must call this module only.");
}
