import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "evolveit-web",
    day: 1,
    ts: new Date().toISOString(),
  });
}
