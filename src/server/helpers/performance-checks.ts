/**
 * The Performance reconciliation checks for stored rows — the one place
 * they're computed from the database, so the Performance page and the
 * "accept this gap" write read the same gap.
 */
import * as schema from "@/lib/db/schema";
import {
  performanceChecks,
  type CheckRow,
  type PerfCheck,
} from "@/lib/pure/performance-checks";
import {
  acceptedAmounts,
  parseAcceptedChecks,
} from "@/lib/pure/performance-annotations";
import { loadYearEndSnapshots } from "@/server/helpers/snapshot-derivatives";
import { toNumber, type DbOrTx } from "@/server/helpers/transforms";

type AccountPerfRow = typeof schema.accountPerformance.$inferSelect;

export function toCheckRow(r: AccountPerfRow): CheckRow {
  return {
    id: r.id,
    year: r.year,
    performanceAccountId: r.performanceAccountId,
    ownerPersonId: r.ownerPersonId,
    beginningBalance: toNumber(r.beginningBalance),
    totalContributions: toNumber(r.totalContributions),
    yearlyGainLoss: toNumber(r.yearlyGainLoss),
    endingBalance: toNumber(r.endingBalance),
    distributions: toNumber(r.distributions),
    fees: toNumber(r.fees),
    rollovers: toNumber(r.rollovers),
    accepted: acceptedAmounts(parseAcceptedChecks(r.acceptedChecks)),
  };
}

/** Checks for every row, given all account_performance rows (`rows`, when
 *  the caller already has them) — every year, inactive rows included. */
export async function loadPerformanceChecks(
  db: DbOrTx,
  rows?: AccountPerfRow[],
): Promise<Map<number, PerfCheck[]>> {
  const all = rows ?? (await db.select().from(schema.accountPerformance));
  return performanceChecks(all.map(toCheckRow), await loadYearEndSnapshots(db));
}
