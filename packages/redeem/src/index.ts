/**
 * Single redeem_ticket module for hub and cloud (Appendix B prohibition 8).
 * Day 2: re-exports the real implementation from packages/shared — do not
 * add a second copy here.
 */
export { redeemTicket } from "@evolveit/shared";
export type { RedeemInput, RedeemResult, RedeemAdapter, TicketRecord } from "@evolveit/shared";