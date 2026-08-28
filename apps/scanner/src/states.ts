// apps/scanner/src/states.ts
import type { RedeemApiResult, ScanState } from "./api";

const STATE_CONFIG: Record<ScanState, { label: string; className: string }> = {
  admit: { label: "ADMIT", className: "state-admit" },
  already_used: { label: "ALREADY USED", className: "state-already-used" },
  not_valid: { label: "NOT VALID", className: "state-not-valid" },
  invalid_code: { label: "INVALID CODE", className: "state-invalid-code" },
  admit_offline: { label: "ADMIT (OFFLINE)", className: "state-admit-offline" },
  hub_and_cloud_down: { label: "HUB & CLOUD DOWN", className: "state-down" },
};

export function renderResult(overlay: HTMLElement, state: ScanState, detail: RedeemApiResult | null): void {
  const cfg = STATE_CONFIG[state];
  overlay.className = cfg.className;

  let sub = "";
  if ((state === "admit" || state === "admit_offline") && detail?.holderName) {
    sub = `${detail.holderName} · ${detail.ticketType ?? ""}`;
  } else if (state === "already_used" && detail?.scannedAt) {
    sub = `Scanned at ${detail.scannedAt}${detail.doorLabel ? ` (${detail.doorLabel})` : ""}`;
  } else if (state === "not_valid" && detail?.reason) {
    sub = detail.reason;
  }

  overlay.innerHTML = `<div class="state-label">${cfg.label}</div>${sub ? `<div class="state-sub">${sub}</div>` : ""}`;
  overlay.classList.remove("hidden");
}

export function clearResult(overlay: HTMLElement): void {
  overlay.className = "hidden";
  overlay.innerHTML = "";
}