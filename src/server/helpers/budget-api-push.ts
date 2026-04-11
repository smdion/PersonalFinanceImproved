/**
 * Shared helper for pushing portfolio snapshot balances to a budget API
 * (YNAB / Actual). Single computation path used by:
 *   - settings.portfolioSnapshots.create (auto-push on new snapshot)
 *   - sync.pushPortfolioToApi             (manual push of latest)
 *   - sync.resyncSnapshot                  (re-push an existing snapshot)
 *
 * Aggregates by remoteAccountId, computes (snapshotSum − liveYnabBalance) per
 * group, posts one transaction per group with a `snapshot:{id}` memo tag.
 *
 * Modes:
 *   create  — skip groups whose remoteAccountId already has a snapshot:{id} tag
 *   resync  — delete existing snapshot:{id} tags first, then recompute and post
 *
 * Errors abort the run and trigger cleanup of any transactions created during
 * the run. Cleanup of pre-resync deletes is not possible (YNAB delete is final).
 */

import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import * as schema from "@/lib/db/schema";
import type { AccountMapping } from "@/lib/db/schema";
import type { BudgetAPIClient } from "@/lib/budget-api";
import type { Db } from "./transforms";
import { accountDisplayName } from "@/lib/utils/format";
import { log } from "@/lib/logger";

export type PushSnapshotMode = "create" | "resync";

export type PushSnapshotResult = {
  groupsPosted: number;
  groupsSkipped: number;
  groupsCleaned: number;
};

type GroupAggregate = {
  remoteAccountId: string;
  total: number;
  contributorLabels: string[];
};

/** Build the memo tag used for idempotency / cleanup matching. */
export function snapshotMemoTag(snapshotId: number): string {
  return `snapshot:${snapshotId}`;
}

/** Build the full memo posted on YNAB transactions. */
function buildMemo(
  snapshotId: number,
  snapshotDate: string,
  contributorLabels: string[],
): string {
  const tag = snapshotMemoTag(snapshotId);
  return `Ledgr ${tag} ${snapshotDate} — ${contributorLabels.join(", ")}`;
}

/**
 * Aggregate snapshot balances into one entry per remoteAccountId.
 * Pure function — no I/O.
 */
function aggregateMappings(
  mappings: AccountMapping[],
  balanceByPerformanceAccountId: Map<number, number>,
  labelByPerformanceAccountId: Map<number, string>,
): GroupAggregate[] {
  const grouped = new Map<string, GroupAggregate>();
  for (const mapping of mappings) {
    if (mapping.syncDirection !== "push" && mapping.syncDirection !== "both") {
      continue;
    }
    const performanceAccountId = mapping.performanceAccountId;
    if (performanceAccountId == null) continue;
    const localBalance =
      balanceByPerformanceAccountId.get(performanceAccountId);
    if (localBalance === undefined) continue;
    const label =
      labelByPerformanceAccountId.get(performanceAccountId) ??
      mapping.localName;
    const entry = grouped.get(mapping.remoteAccountId) ?? {
      remoteAccountId: mapping.remoteAccountId,
      total: 0,
      contributorLabels: [],
    };
    entry.total += localBalance;
    if (!entry.contributorLabels.includes(label)) {
      entry.contributorLabels.push(label);
    }
    grouped.set(mapping.remoteAccountId, entry);
  }
  return Array.from(grouped.values());
}

/** Build per-snapshot inputs from the DB: balances + display labels keyed by performanceAccountId. */
async function loadSnapshotPushInputs(
  db: Db,
  snapshotId: number,
): Promise<{
  balanceByPerformanceAccountId: Map<number, number>;
  labelByPerformanceAccountId: Map<number, string>;
}> {
  const [snapshotAccounts, performanceAccounts, people] = await Promise.all([
    db
      .select()
      .from(schema.portfolioAccounts)
      .where(eq(schema.portfolioAccounts.snapshotId, snapshotId)),
    db.select().from(schema.performanceAccounts),
    db.select().from(schema.people),
  ]);

  const balanceByPerformanceAccountId = new Map<number, number>();
  for (const account of snapshotAccounts) {
    if (account.performanceAccountId == null) continue;
    balanceByPerformanceAccountId.set(
      account.performanceAccountId,
      (balanceByPerformanceAccountId.get(account.performanceAccountId) ?? 0) +
        Number(account.amount),
    );
  }

  const peopleById = new Map(people.map((p) => [p.id, p.name]));
  const performanceById = new Map(performanceAccounts.map((p) => [p.id, p]));

  // For label, pick the first matching snapshot row per performanceAccountId
  // and use accountDisplayName per RULES §Data Model rule 10.
  const labelByPerformanceAccountId = new Map<number, string>();
  for (const account of snapshotAccounts) {
    const performanceAccountId = account.performanceAccountId;
    if (performanceAccountId == null) continue;
    if (labelByPerformanceAccountId.has(performanceAccountId)) continue;
    const performance = performanceById.get(performanceAccountId);
    const ownerName = account.ownerPersonId
      ? peopleById.get(account.ownerPersonId)
      : undefined;
    labelByPerformanceAccountId.set(
      performanceAccountId,
      accountDisplayName(
        {
          accountType: account.accountType,
          subType: account.subType,
          label: account.label,
          institution: account.institution,
          displayName: performance?.displayName,
          accountLabel: performance?.accountLabel,
        },
        ownerName ?? undefined,
      ),
    );
  }

  return { balanceByPerformanceAccountId, labelByPerformanceAccountId };
}

/**
 * Push a snapshot's balances to the budget API. See module docs for semantics.
 */
export async function pushSnapshotToBudgetApi(input: {
  db: Db;
  snapshotId: number;
  snapshotDate: string;
  mappings: AccountMapping[];
  client: BudgetAPIClient;
  mode: PushSnapshotMode;
  asOfDate: Date;
}): Promise<PushSnapshotResult> {
  const { db, snapshotId, snapshotDate, mappings, client, mode } = input;

  const { balanceByPerformanceAccountId, labelByPerformanceAccountId } =
    await loadSnapshotPushInputs(db, snapshotId);

  const groups = aggregateMappings(
    mappings,
    balanceByPerformanceAccountId,
    labelByPerformanceAccountId,
  );

  if (groups.length === 0) {
    return { groupsPosted: 0, groupsSkipped: 0, groupsCleaned: 0 };
  }

  const tag = snapshotMemoTag(snapshotId);
  // since_date for the transaction list query — broad enough to catch any
  // previously-tagged transaction. Tracking accounts have low transaction
  // volume so a 10-year window is cheap.
  const sinceDate = `${asOfYear(input.asOfDate) - 10}-01-01`;

  // ── Phase 1: scan + (resync only) cleanup ──────────────────────────────
  // Per RULES §Single Computation Path: only scan accounts we are about to
  // touch (the current mapping set). Orphan tags from removed mappings are
  // intentionally left alone.
  const skippedRemoteAccountIds = new Set<string>();
  let groupsCleaned = 0;
  const cleanupFailures: Array<{ transactionId: string; error: string }> = [];
  const cleanupDeleted: string[] = [];

  for (const group of groups) {
    let existing;
    try {
      existing = await client.getAccountTransactions(
        group.remoteAccountId,
        sinceDate,
      );
    } catch (cause) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to list transactions on ${group.remoteAccountId}: ${errorMessage(cause)}`,
        cause,
      });
    }

    const tagged = existing.filter((t) => (t.memo ?? "").includes(tag));
    if (tagged.length === 0) continue;

    if (mode === "create") {
      skippedRemoteAccountIds.add(group.remoteAccountId);
      continue;
    }

    // resync: delete each tagged transaction. Track successes and failures
    // so we can surface a precise reconciliation message on abort.
    for (const taggedTx of tagged) {
      try {
        await client.deleteTransaction(taggedTx.id);
        cleanupDeleted.push(taggedTx.id);
      } catch (cause) {
        cleanupFailures.push({
          transactionId: taggedTx.id,
          error: errorMessage(cause),
        });
      }
    }
    groupsCleaned++;
  }

  if (cleanupFailures.length > 0) {
    log("error", "snapshot_resync_cleanup_failed", {
      snapshotId,
      deleted: cleanupDeleted,
      failed: cleanupFailures,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        `Resync cleanup partially failed for snapshot ${snapshotId}. ` +
        `Deleted ${cleanupDeleted.length} transactions, but ${cleanupFailures.length} could not be deleted: ` +
        cleanupFailures
          .map((f) => `${f.transactionId} (${f.error})`)
          .join("; ") +
        ". Reconcile the failed transactions manually in YNAB before retrying.",
    });
  }

  // ── Phase 2: post deltas ────────────────────────────────────────────────
  // Track created transactions so we can roll back on later failure.
  const createdTransactionIds: Array<{
    remoteAccountId: string;
    transactionId: string;
  }> = [];
  let groupsPosted = 0;

  try {
    for (const group of groups) {
      if (
        mode === "create" &&
        skippedRemoteAccountIds.has(group.remoteAccountId)
      ) {
        continue;
      }
      // Always read the current YNAB balance live — for resync, the cache
      // is now stale because we just deleted transactions.
      const currentBalance = await client.getAccountBalance(
        group.remoteAccountId,
      );
      const difference = Math.round((group.total - currentBalance) * 100) / 100;
      const memo = buildMemo(snapshotId, snapshotDate, group.contributorLabels);
      const transactionId = await client.createTransaction({
        accountId: group.remoteAccountId,
        date: snapshotDate,
        amount: difference,
        payeeName: "Portfolio Sync",
        memo,
        cleared: true,
        approved: true,
      });
      createdTransactionIds.push({
        remoteAccountId: group.remoteAccountId,
        transactionId,
      });
      groupsPosted++;
    }
  } catch (cause) {
    // Rollback: delete every transaction we just created.
    const rollbackFailures: Array<{ transactionId: string; error: string }> =
      [];
    for (const created of createdTransactionIds) {
      try {
        await client.deleteTransaction(created.transactionId);
      } catch (rollbackCause) {
        rollbackFailures.push({
          transactionId: created.transactionId,
          error: errorMessage(rollbackCause),
        });
      }
    }
    log("error", "snapshot_push_aborted", {
      snapshotId,
      mode,
      cause: errorMessage(cause),
      rolledBack: createdTransactionIds.length - rollbackFailures.length,
      rollbackFailures,
    });
    const baseMessage = `Snapshot ${snapshotId} push failed: ${errorMessage(cause)}`;
    const rollbackMessage =
      rollbackFailures.length === 0
        ? ` Rolled back ${createdTransactionIds.length} created transactions.`
        : ` Created ${createdTransactionIds.length} transactions; rolled back ${createdTransactionIds.length - rollbackFailures.length}; ${rollbackFailures.length} could not be rolled back: ` +
          rollbackFailures
            .map((f) => `${f.transactionId} (${f.error})`)
            .join("; ") +
          ". Reconcile manually in YNAB.";
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: baseMessage + rollbackMessage,
      cause,
    });
  }

  return {
    groupsPosted,
    groupsSkipped: skippedRemoteAccountIds.size,
    groupsCleaned,
  };
}

function asOfYear(date: Date): number {
  return date.getFullYear();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
