// apps/scanner/src/api.ts
import type { DeviceSession } from "./login";

export type Outcome = "admit" | "already_used" | "not_valid" | "invalid_code";
export type ScanState = Outcome | "admit_offline" | "hub_and_cloud_down";

export interface RedeemApiResult {
  outcome: Outcome;
  offline?: boolean;
  holderName?: string;
  ticketType?: string;
  scannedAt?: string;
  doorLabel?: string | null;
  reason?: string;
}

export async function postScan(
  session: DeviceSession,
  ticketId: string,
  totpCode: string
): Promise<{ state: ScanState; detail: RedeemApiResult | null }> {
  try {
    const res = await fetch(new URL("/scan", session.hubLanUrl).toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Device ${session.deviceId}.${session.apiKey}`,
      },
      body: JSON.stringify({ ticketId, totpCode, doorLabel: session.label }),
      signal: AbortSignal.timeout(5_000),
    });

    const data = (await res.json()) as RedeemApiResult;
    if (!res.ok) return { state: "not_valid", detail: data };

    if (data.outcome === "admit") {
      return { state: data.offline ? "admit_offline" : "admit", detail: data };
    }
    return { state: data.outcome, detail: data };
  } catch {
    // Hub unreachable on LAN.
    return { state: "hub_and_cloud_down", detail: null };
  }
}