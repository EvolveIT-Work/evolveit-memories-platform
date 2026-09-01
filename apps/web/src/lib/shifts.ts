import type { PostgresLikeClient } from "@evolveit/shared";

/**
 * Returns the tenant's currently open shift id, opening one if none
 * exists yet. Day 5 will add explicit shift open/close management
 * (Section 06 "Shift Close Report") with a manager-driven open action;
 * until then, cash collection (Section 04/05) still requires a
 * not-nullable shift_id on every cash_movements row, so the first Cash
 * Received of the operating night opens the shift implicitly.
 *
 * shifts_one_open_per_tenant (a partial unique index on tenant_id WHERE
 * closed_at IS NULL) is the actual guarantee against two open shifts —
 * the try/catch here only handles losing a race against a concurrent
 * caller hitting that same constraint, not enforcing it itself.
 */
export async function getOrOpenShift(pg: PostgresLikeClient, tenantId: string, openedBy: string): Promise<string> {
  const { rows } = await pg.query(`SELECT id FROM shifts WHERE tenant_id = $1 AND closed_at IS NULL LIMIT 1`, [
    tenantId,
  ]);
  if (rows[0]?.id) return rows[0].id as string;

  try {
    const { rows: inserted } = await pg.query(`INSERT INTO shifts (tenant_id, opened_by) VALUES ($1, $2) RETURNING id`, [
      tenantId,
      openedBy,
    ]);
    return inserted[0].id as string;
  } catch (err) {
    const { rows: existing } = await pg.query(
      `SELECT id FROM shifts WHERE tenant_id = $1 AND closed_at IS NULL LIMIT 1`,
      [tenantId],
    );
    if (!existing[0]?.id) throw err;
    return existing[0].id as string;
  }
}
