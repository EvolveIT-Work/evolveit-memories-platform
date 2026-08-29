// apps/scanner/src/states.ts
import type { RedeemApiResult, ScanState } from "./api";

const ICON_TICK = `<svg class="state-icon" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 62 L48 90 L100 30" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

const ICON_WARNING = `<svg class="state-icon" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M60 12 L114 104 H6 Z" stroke="#fff" stroke-width="8" stroke-linejoin="round" fill="none"/>
  <rect x="55" y="46" width="10" height="30" fill="#fff"/>
  <rect x="55" y="84" width="10" height="10" fill="#fff"/>
</svg>`;

const ICON_X = `<svg class="state-icon" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M25 25 L95 95 M95 25 L25 95" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
</svg>`;

// Result | background | icon | primary (40px bold) | secondary (24px)
// — matches "Scanner Result States — Exact Screen Specification" verbatim.
const STATE_CONFIG: Record<ScanState, { label: string; className: string; icon: string }> = {
  admit: { label: "ADMIT", className: "state-admit", icon: ICON_TICK },
  already_used: { label: "ALREADY USED", className: "state-already-used", icon: ICON_WARNING },
  not_valid: { label: "NOT VALID", className: "state-not-valid", icon: ICON_X },
  invalid_code: { label: "INVALID CODE", className: "state-invalid-code", icon: ICON_X },
  admit_offline: { label: "ADMIT (OFFLINE)", className: "state-admit-offline", icon: ICON_TICK },
  // Spec's primary text for this state is "CANNOT VERIFY", not a restatement
  // of the state name.
  hub_and_cloud_down: { label: "CANNOT VERIFY", className: "state-down", icon: ICON_WARNING },
};

const REASON_TEXT: Record<string, string> = {
  voided: "voided",
  expired: "expired",
  wrong_event: "wrong event",
};

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function renderResult(overlay: HTMLElement, state: ScanState, detail: RedeemApiResult | null): void {
  const cfg = STATE_CONFIG[state];
  overlay.className = cfg.className;

  let sub = "";
  let banner = "";

  if (state === "admit" && detail?.holderName) {
    sub = `${detail.holderName} · ${detail.ticketType ?? ""}`;
  } else if (state === "admit_offline" && detail?.holderName) {
    // Spec: "Verify name: [holder name]. Hub unavailable."
    sub = `Verify name: ${detail.holderName}. Hub unavailable.`;
    banner = "HUB UNAVAILABLE";
  } else if (state === "already_used" && detail?.scannedAt) {
    // Spec: "Scanned at HH:MM — Door N"
    sub = `Scanned at ${formatHHMM(detail.scannedAt)}${detail.doorLabel ? ` — ${detail.doorLabel}` : ""}`;
  } else if (state === "not_valid" && detail?.reason) {
    // Spec: "Reason: voided / expired / wrong event"
    sub = `Reason: ${REASON_TEXT[detail.reason] ?? detail.reason}`;
  } else if (state === "invalid_code") {
    sub = "Try manual serial entry";
  } else if (state === "hub_and_cloud_down") {
    sub = "Do not admit on screenshots. Contact manager.";
  }

  overlay.innerHTML = `${banner ? `<div class="state-banner">${banner}</div>` : ""}${cfg.icon}<div class="state-label">${cfg.label}</div>${sub ? `<div class="state-sub">${sub}</div>` : ""}`;
  overlay.classList.remove("hidden");
}

export function clearResult(overlay: HTMLElement): void {
  overlay.className = "hidden";
  overlay.innerHTML = "";
}
