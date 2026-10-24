/**
 * The materialized values that hang off a portfolio snapshot's balances,
 * re-derived in exactly one place so the fresh-snapshot path
 * (`portfolioSnapshots.create`) and the latest-snapshot single-balance
 * edit path (`portfolioSnapshots.updateAccount` with `amount`) can never
 * drift (RULES §Single Computation Path).
 *
 * Two concerns, both idempotent:
 *  - `refreshSnapshotYearDerivatives` — `account_performance.ending_balance`
 *    for the snapshot's year + the `annual_performance` category rollups,
 *    when the snapshot is that year's latest and the year isn't finalized.
 *  - `pushSnapshotIfConfigured` — post the snapshot's balances to the
 *    active budget API (YNAB / Actual), if one is configured with account
 *    mappings. `mode: "create"` skips groups already tagged for this
 *    snapshot; `mode: "resync"` deletes the prior tag and re-posts.
 */
import { and, eq, gt, lte } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import { computeSnapshotEndingBalances } from "@/lib/pure/portfolio";
import type { DbType } from "@/server/routers/settings/_shared";
import {
  captureYearRollups,
  syncYearRollups,
} from "@/server/helpers/performance-rollups";
import { pushSnapshotToBudgetApi } from "@/server/helpers";
import type { PushSnapshotMode } from "@/server/helpers/budget-api-push";

/**
 * Re-derive `account_performance.ending_balance` for the snapshot's year
 * from the snapshot's balances, then bring that year's `annual_performance`
 * rollups in step.
 *
 * Only the year's latest snapshot sets its ending balances: a back-dated
 * snapshot (an earlier date in a year that already has a later one) is
 * history, not the year's current figure. A finalized year is left alone —
 * its year-end figures are settled in Performance, and a snapshot added
 * later doesn't reopen them.
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
 * Must run inside the same transaction as the balance write. Says whether
 * Performance followed the snapshot, or why not.
 */
export type SnapshotPerformanceSync =
  "synced" | "earlier-snapshot" | "year-finalized";

export async function refreshSnapshotYearDerivatives(
  tx: DbType,
  snapshotDate: string,
  accounts: { performanceAccountId: number | null; amount: string }[],
): Promise<SnapshotPerformanceSync> {
  const snapshotYear = parseInt(snapshotDate.substring(0, 4), 10);
  const [later] = await tx
    .select({ id: schema.portfolioSnapshots.id })
    .from(schema.portfolioSnapshots)
    .where(
      and(
        gt(schema.portfolioSnapshots.snapshotDate, snapshotDate),
        lte(schema.portfolioSnapshots.snapshotDate, `${snapshotYear}-12-31`),
      ),
    )
    .limit(1);
  if (later) return "earlier-snapshot";
  const [finalized] = await tx
    .select({ id: schema.annualPerformance.id })
    .from(schema.annualPerformance)
    .where(
      and(
        eq(schema.annualPerformance.year, snapshotYear),
        eq(schema.annualPerformance.isFinalized, true),
      ),
    )
    .limit(1);
  if (finalized) return "year-finalized";

  const currentYearAcctPerf = await tx
    .select()
    .from(schema.accountPerformance)
    .where(eq(schema.accountPerformance.year, snapshotYear));

  const perfTotals = computeSnapshotEndingBalances(accounts);
  if (perfTotals.size === 0) return "synced";
  const before = await captureYearRollups(tx, snapshotYear);

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

  await syncYearRollups(tx, before);
  return "synced";
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
