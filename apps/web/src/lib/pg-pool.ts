import { Pool } from "pg";
import type { PostgresLikeClient } from "@evolveit/shared";

/**
 * Single pooled Postgres connection, reused by every route that needs
 * createPostgresRedeemAdapter (Appendix B #8: one redeem module, shared
 * by hub and cloud — this is the cloud side of that sharing). Do not add
 * a second pool or a second raw-SQL client anywhere else in apps/web.
 */
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("Missing DATABASE_URL");
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

export function createPgClient(): PostgresLikeClient {
  return {
    async query(sql: string, params?: unknown[]) {
      const result = await getPool().query(sql, params as unknown[]);
      return { rows: result.rows as Record<string, unknown>[] };
    },
  };
}

export function getPlatformAesKey(): Buffer {
  const b64 = process.env.PLATFORM_AES_KEY_B64;
  if (!b64) {
    throw new Error("Missing PLATFORM_AES_KEY_B64");
  }
  return Buffer.from(b64, "base64");
}
