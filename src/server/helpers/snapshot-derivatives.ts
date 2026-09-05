/**
 * The materialized values that hang off a portfolio snapshot's balances,
 * re-derived in exactly one place so the fresh-snapshot path
 * (`portfolioSnapshots.create`) and the latest-snapshot single-balance
 * edit path (`portfolioSnapshots.updateAccount` with `amount`) can never
 * drift (RULES §Single Computation Path).
 *
 * Two concerns, both idempotent:
 *  - `refreshSnapshotYearDerivatives` — `account_performance.ending_balance`
 *    for the snapshot's year + the `annual_performance` category rollups.
 *  - `pushSnapshotIfConfigured` — post the snapshot's balances to the
 *    active budget API (YNAB / Actual), if one is configured with account
 *    mappings. `mode: "create"` skips groups already tagged for this
 *    snapshot; `mode: "resync"` deletes the prior tag and re-posts.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import { computeSnapshotEndingBalances } from "@/lib/pure/portfolio";
import {
  recomputeAnnualRollups,
  type DbType,
} from "@/server/routers/settings/_shared";
import { pushSnapshotToBudgetApi } from "@/server/helpers";
import type { PushSnapshotMode } from "@/server/helpers/budget-api-push";

/**
 * Re-derive `account_performance.ending_balance` for `snapshotYear` from
 * the snapshot's balances, then recompute that year's `annual_performance`
 * category rollups.
 *
 * `accounts` is the FULL resolved account set for the snapshot — every row
 * that contributes to a perf-account total, already carrying the same
 * closed-master zeroing the row insert used, so this total is never a
 * second, independently-derived view.
 *
 * Does NOT stamp `performance_last_updated` — a snapshot save is
 * independent of performance tracking; only explicit performance edits
 * move that date.
 *
 * Must run inside the same transaction as the balance write.
 */
export async function refreshSnapshotYearDerivatives(
  tx: DbType,
  snapshotYear: number,
  accounts: { performanceAccountId: number | null; amount: string }[],
): Promise<void> {
  const currentYearAcctPerf = await tx
    .select()
    .from(schema.accountPerformance)
    .where(eq(schema.accountPerformance.year, snapshotYear));

  const perfTotals = computeSnapshotEndingBalances(accounts);

  const updatedPerfIds = new Set<number>();
  for (const acctPerf of currentYearAcctPerf) {
    if (
      acctPerf.performanceAccountId &&
      perfTotals.has(acctPerf.performanceAccountId)
    ) {
      if (updatedPerfIds.has(acctPerf.performanceAccountId)) {
        log("warn", "snapshot_sync_duplicate_perf_row", {
          acctPerfId: acctPerf.id,
          performanceAccountId: acctPerf.performanceAccountId,
          year: snapshotYear,
        });
        continue;
      }
      updatedPerfIds.add(acctPerf.performanceAccountId);
      const newBalance = perfTotals.get(acctPerf.performanceAccountId)!;
      await tx
        .update(schema.accountPerformance)
        .set({ endingBalance: newBalance.toFixed(2) })
        .where(eq(schema.accountPerformance.id, acctPerf.id));
    }
  }

  if (perfTotals.size > 0) {
    await recomputeAnnualRollups(tx, snapshotYear);
  }
}

export type SnapshotPushResult = {
  pushed: boolean;
  accountsPushed: number;
  accountsSkipped?: number;
  error?: string;
};

/**
 * Post a snapshot's balances to the active budget API's tracking accounts,
 * if one is configured with mappings. Never throws — a budget-API failure
 * must not roll back an already-committed snapshot write; the caller
 * decides how loudly to surface `error`.
 */
export async function pushSnapshotIfConfigured(
  db: DbType,
  opts: {
    snapshotId: number;
    snapshotDate: string;
    mode: PushSnapshotMode;
    asOfDate: Date;
  },
): Promise<SnapshotPushResult> {
  try {
    const { getActiveBudgetApi, getClientForService, getApiConnection } =
      await import("@/lib/budget-api");
    const active = await getActiveBudgetApi(db);
    if (active === "none") return { pushed: false, accountsPushed: 0 };

    const conn = await getApiConnection(db, active);
    const mappings = conn?.accountMappings ?? [];
    const client = await getClientForService(db, active);
    if (!client || mappings.length === 0)
      return { pushed: false, accountsPushed: 0 };

    const result = await pushSnapshotToBudgetApi({
      db,
      snapshotId: opts.snapshotId,
      snapshotDate: opts.snapshotDate,
      mappings,
      client,
      mode: opts.mode,
      asOfDate: opts.asOfDate,
    });
    return {
      pushed: true,
      accountsPushed: result.groupsPosted,
      accountsSkipped: result.groupsSkipped,
    };
  } catch (e) {
    return {
      pushed: false,
      accountsPushed: 0,
      error: e instanceof Error ? e.message : "Unknown error",
    };
  }
}
