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
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import { userMessageFor } from "@/lib/budget-api/errors";
import { computeSnapshotEndingBalances } from "@/lib/pure/accounts/portfolio";
import {
  ownerKey,
  type YearEndSnapshot,
} from "@/lib/pure/investments/performance-checks";
import { parseEstimatedFields } from "@/lib/pure/investments/performance-annotations";
import { toNumber } from "@/lib/utils/numbers";
import {
  captureYearRollups,
  syncYearRollups,
} from "@/server/services/performance/performance-rollups";
import { pushSnapshotToBudgetApi } from "@/server/services/sync/budget-api-push";
import type { PushSnapshotMode } from "@/server/services/sync/budget-api-push";
import type { DbOrTx } from "@/lib/db";

/**
 * Each year's latest snapshot — the one that sets that year's ending
 * balances. The single rule for "the year's snapshot", shared by the sync
 * below and the Performance checks so they can't disagree.
 */
async function lastSnapshotPerYear(
  db: DbOrTx,
): Promise<Map<number, { id: number; date: string }>> {
  const all = await db
    .select({
      id: schema.portfolioSnapshots.id,
      date: schema.portfolioSnapshots.snapshotDate,
    })
    .from(schema.portfolioSnapshots);
  const last = new Map<number, { id: number; date: string }>();
  for (const s of all) {
    const y = parseInt(s.date.substring(0, 4), 10);
    const cur = last.get(y);
    if (!cur || s.date > cur.date) last.set(y, s);
  }
  return last;
}

/** Each year's latest snapshot balances, per account (as the sync totals
 *  them) and per account + person (for accounts held in parts). */
export async function loadYearEndSnapshots(
  db: DbOrTx,
): Promise<YearEndSnapshot[]> {
  const last = await lastSnapshotPerYear(db);
  if (last.size === 0) return [];
  const rows = await db
    .select({
      snapshotId: schema.portfolioAccounts.snapshotId,
      performanceAccountId: schema.portfolioAccounts.performanceAccountId,
      ownerPersonId: schema.portfolioAccounts.ownerPersonId,
      amount: schema.portfolioAccounts.amount,
    })
    .from(schema.portfolioAccounts)
    .where(
      inArray(
        schema.portfolioAccounts.snapshotId,
        Array.from(last.values(), (v) => v.id),
      ),
    );
  return Array.from(last, ([year, snap]) => {
    const own = rows.filter((a) => a.snapshotId === snap.id);
    const byAccountOwner = new Map<string, number>();
    for (const a of own)
      if (a.performanceAccountId != null) {
        const k = ownerKey(a.performanceAccountId, a.ownerPersonId);
        byAccountOwner.set(
          k,
          (byAccountOwner.get(k) ?? 0) + toNumber(a.amount),
        );
      }
    return {
      year,
      date: snap.date,
      byAccount: computeSnapshotEndingBalances(own),
      byAccountOwner,
    };
  });
}

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
type SnapshotPerformanceSync = "synced" | "earlier-snapshot" | "year-finalized";

export async function refreshSnapshotYearDerivatives(
  tx: DbOrTx,
  snapshotDate: string,
  accounts: { performanceAccountId: number | null; amount: string }[],
): Promise<SnapshotPerformanceSync> {
  const snapshotYear = parseInt(snapshotDate.substring(0, 4), 10);
  const last = (await lastSnapshotPerYear(tx)).get(snapshotYear);
  if (last && last.date > snapshotDate) return "earlier-snapshot";
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

  const currentYearAccountPerf = await tx
    .select()
    .from(schema.accountPerformance)
    .where(eq(schema.accountPerformance.year, snapshotYear));

  const perfTotals = computeSnapshotEndingBalances(accounts);
  if (perfTotals.size === 0) return "synced";
  const before = await captureYearRollups(tx, snapshotYear);

  const updatedPerfIds = new Set<number>();
  for (const accountPerf of currentYearAccountPerf) {
    if (
      accountPerf.performanceAccountId &&
      perfTotals.has(accountPerf.performanceAccountId)
    ) {
      if (updatedPerfIds.has(accountPerf.performanceAccountId)) {
        log("warn", "snapshot_sync_duplicate_perf_row", {
          accountPerfId: accountPerf.id,
          performanceAccountId: accountPerf.performanceAccountId,
          year: snapshotYear,
        });
        continue;
      }
      updatedPerfIds.add(accountPerf.performanceAccountId);
      const newBalance = perfTotals.get(accountPerf.performanceAccountId)!;
      // A snapshot is a real balance: the ending is no longer an estimate.
      await tx
        .update(schema.accountPerformance)
        .set({
          endingBalance: newBalance.toFixed(2),
          estimatedFields: parseEstimatedFields(
            accountPerf.estimatedFields,
          ).filter((f) => f !== "endingBalance"),
        })
        .where(eq(schema.accountPerformance.id, accountPerf.id));
    }
  }

  await syncYearRollups(tx, before);
  return "synced";
}

type SnapshotPushResult = {
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
  db: DbOrTx,
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
      error:
        userMessageFor(e) ?? (e instanceof Error ? e.message : "Unknown error"),
    };
  }
}
