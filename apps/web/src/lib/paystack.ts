import "server-only";

// Thin wrapper around Paystack's transaction/initialize endpoint. Used by
// both the (future) ticket checkout flow and order/start-payment — keep
// this the single place that talks to Paystack's initialize API so the
// metadata shape stays consistent with what paystack-webhook expects.

interface InitializeParams {
  email: string;
  amountPesewas: number;
  metadata: Record<string, unknown>;
  callbackUrl: string;
}

interface InitializeResult {
  authorizationUrl: string;
  reference: string;
}

export async function paystackInitialize(params: InitializeParams): Promise<InitializeResult> {
  const secret = process.env.PAYSTACK_SECRET;
  if (!secret) {
    throw new Error("Missing PAYSTACK_SECRET");
  }

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      amount: params.amountPesewas,
      currency: "GHS",
      metadata: params.metadata,
      callback_url: params.callbackUrl,
    }),
  });

  const body = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: { authorization_url: string; reference: string };
  };

  if (!res.ok || !body.status || !body.data) {
    throw new Error(`Paystack initialize failed: ${body.message ?? res.status}`);
  }

  return { authorizationUrl: body.data.authorization_url, reference: body.data.reference };
}

// Paystack requires an email even where the spec's own flow only
// collects a phone number (counter/table ordering has no email field).
// Synthesizing one from the phone number is a Paystack API requirement,
// not a spec deviation — the phone number stays the real identifier
// used everywhere else (order lookup, refunds, delivery).
//
// Paystack's own validation rejects reserved/non-public TLDs (e.g.
// .local) as "Invalid Email Address Passed" even though the format is
// otherwise well-formed — found by actually calling the real API.
// Using .com keeps it passing Paystack's check without claiming to be
// a deliverable address.
export function syntheticEmailFromPhone(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return `guest.${digits}@memoriesnightclub.com`;
}
