import type { IncomingMessage, ServerResponse } from "node:http";
import type Database from "better-sqlite3";
import { redeemTicket, type RedeemResult } from "@evolveit/redeem";
import { createSqliteRedeemAdapter } from "@evolveit/shared";
import { verifyDoorDevice } from "./auth";
import { syncState } from "./sync";

function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

export async function handleLogin(req: IncomingMessage, res: ServerResponse, db: Database.Database): Promise<void> {
  const device = await verifyDoorDevice(db, req.headers.authorization);
  if (!device) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  sendJson(res, 200, { deviceId: device.id, label: device.label, role: device.role });
}

export async function handleScan(req: IncomingMessage, res: ServerResponse, db: Database.Database): Promise<void> {
  const device = await verifyDoorDevice(db, req.headers.authorization);
  if (!device) {
    sendJson(res, 401, { outcome: "not_valid", reason: "unauthorized" });
    return;
  }

  let body: { ticketId?: string; totpCode?: string; doorLabel?: string };
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { outcome: "invalid_code" });
    return;
  }

  if (!body.ticketId || !body.totpCode) {
    sendJson(res, 400, { outcome: "invalid_code" });
    return;
  }

  const adapter = createSqliteRedeemAdapter(db);
  const result: RedeemResult = await redeemTicket(
    {
      ticketId: body.ticketId,
      totpCode: body.totpCode,
      deviceId: device.id,
      scannedBy: device.id,
      doorLabel: body.doorLabel ?? device.label,
    },
    adapter,
  );

  sendJson(res, 200, { ...result, offline: !syncState.lastPullOk });
}