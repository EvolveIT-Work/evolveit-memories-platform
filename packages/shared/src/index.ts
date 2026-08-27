/** Shared types. Monetary values are integer pesewas (Appendix B #5). */
export type Pesewas = number;

export const FEATURE_KEYS = [
  "ticketing",
  "ordering.counter",
  "ordering.table",
  "accounting",
  "organiser",
  "venue",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const STAFF_ROLES = [
  "owner",
  "manager",
  "door",
  "waiter",
  "bartender",
  "kitchen",
  "cashier",
  "organiser",
] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const DEVICE_ROLES = ["hub", "door", "bar_display", "kitchen_display"] as const;
export type DeviceRole = (typeof DEVICE_ROLES)[number];

export const MEMORIES_TENANT_ID = "11111111-1111-1111-1111-111111111111";
export const TEST_VENUE_TENANT_ID = "22222222-2222-2222-2222-222222222222";

export type HubTestSnapshot = {
  type: "test";
  tenant_id: string;
  generated_at: string;
  features: { feature_key: FeatureKey; enabled: boolean }[];
  devices: { id: string; role: DeviceRole; label: string; revoked: boolean }[];
  ticket_count: number;
  revocation_count: number;
};
