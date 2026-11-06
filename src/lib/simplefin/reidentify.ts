// An account keeps its row when only its SimpleFIN id changed, so a
// re-added institution never arrives as a second copy counting the same
// money. Runs in the sync's balance transaction, before the upsert.
import "server-only";
import { eq, inArray, min } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { log } from "@/lib/logger";
import {
  pairCopiedTransactions,
  planReidentify,
  type ErrorScope,
} from "@/lib/pure/sync/simplefin-reidentify";
import type { SimplefinAccount } from "./client";
import { REDACTED_MEDICAL_DESCRIPTION } from "./ingest";
import type { DbOrTx } from "@/lib/db";

const timeKey = (d: Date | null) => (d === null ? "" : String(d.getTime()));

/** Move the copy's history onto the kept row, then delete the copy. On a
 *  clash (a unique key, or a transaction under a new id) the kept row's
 *  stays: its history is what's shown, and its locks and ids are kept. */
async function mergeCopy(
  tx: DbOrTx,
  keepId: number,
  dropId: number,
): Promise<{ moved: number; dropped: number }> {
  let copyRows = 0;
  const b = schema.simplefinAccountBalances;
  const h = schema.holdingObservations;
  const t = schema.investmentTransactions;
  const balances = await tx
    .select({ id: b.id, acct: b.simplefinAccountId, at: b.balanceDate })
    .from(b)
    .where(inArray(b.simplefinAccountId, [keepId, dropId]));
  const holdings = await tx
    .select({
      id: h.id,
      acct: h.simplefinAccountId,
      securityId: h.securityId,
      at: h.balanceDate,
      asOf: h.asOf,
    })
    .from(h)
    .where(inArray(h.simplefinAccountId, [keepId, dropId]));
  const transactions = (
    await tx
      .select()
      .from(t)
      .where(inArray(t.simplefinAccountId, [keepId, dropId]))
  ).map((r) => ({
    id: r.id,
    acct: r.simplefinAccountId,
    externalId: r.externalId,
    posted: r.posted,
    amount: Number(r.amount),
    description: r.description,
    pending: r.pending,
    voided: r.voidedAt !== null,
  }));
  /** The copy's rows whose key the kept row already holds. */
  const clashes = <R extends { id: number; acct: number }>(
    rows: R[],
    key: (r: R) => string,
  ) => {
    const kept = new Set(rows.filter((r) => r.acct === keepId).map(key));
    const copy = rows.filter((r) => r.acct === dropId);
    copyRows += copy.length;
    return copy.filter((r) => kept.has(key(r))).map((r) => r.id);
  };
  const dropBalances = clashes(balances, (r) => timeKey(r.at));
  const dropHoldings = clashes(holdings, (r) =>
    r.at === null
      ? `${r.securityId}|day|${r.asOf}`
      : `${r.securityId}|at|${timeKey(r.at)}`,
  );
  // A kept row still pending doesn't pair with the copy's posted one; the
  // reconcile voids it once its window passes.
  const exactTransactions = clashes(transactions, (r) => r.externalId);
  // The kept row's transaction takes the copy's new id, so the next window
  // matches it instead of adding the copy's again.
  const renamed = pairCopiedTransactions(
    transactions.filter((r) => r.acct === keepId),
    transactions.filter((r) => r.acct === dropId),
    REDACTED_MEDICAL_DESCRIPTION,
  );
  const dropTransactions = [
    ...exactTransactions,
    ...renamed.map((p) => p.copyId),
  ];
  if (dropBalances.length > 0)
    await tx.delete(b).where(inArray(b.id, dropBalances));
  if (dropHoldings.length > 0)
    await tx.delete(h).where(inArray(h.id, dropHoldings));
  if (dropTransactions.length > 0)
    await tx.delete(t).where(inArray(t.id, dropTransactions));
  for (const p of renamed)
    await tx
      .update(t)
      .set({ externalId: p.externalId })
      .where(eq(t.id, p.keptId));
  await tx
    .update(b)
    .set({ simplefinAccountId: keepId })
    .where(eq(b.simplefinAccountId, dropId));
  await tx
    .update(h)
    .set({ simplefinAccountId: keepId })
    .where(eq(h.simplefinAccountId, dropId));
  await tx
    .update(t)
    .set({ simplefinAccountId: keepId })
    .where(eq(t.simplefinAccountId, dropId));
  await tx
    .delete(schema.simplefinAccounts)
    .where(eq(schema.simplefinAccounts.id, dropId));
  const dropped =
    dropBalances.length + dropHoldings.length + dropTransactions.length;
  return { moved: copyRows - dropped, dropped };
}

/** When each account's earliest balance, holding or transaction was stored. */
async function firstHistoryByAccount(tx: DbOrTx): Promise<Map<number, Date>> {
  const b = schema.simplefinAccountBalances;
  const h = schema.holdingObservations;
  const t = schema.investmentTransactions;
  const rows = [
    ...(await tx
      .select({ acct: b.simplefinAccountId, at: min(b.createdAt) })
      .from(b)
      .groupBy(b.simplefinAccountId)),
    ...(await tx
      .select({ acct: h.simplefinAccountId, at: min(h.createdAt) })
      .from(h)
      .groupBy(h.simplefinAccountId)),
    ...(await tx
      .select({ acct: t.simplefinAccountId, at: min(t.firstSeenAt) })
      .from(t)
      .groupBy(t.simplefinAccountId)),
  ];
  const first = new Map<number, Date>();
  for (const { acct, at } of rows) {
    const prev = first.get(acct);
    if (at && (!prev || at < prev)) first.set(acct, at);
  }
  return first;
}

/** Merge the copy into the kept row: its history moves, and the row takes
 *  its SimpleFIN id and last report. `by`: the sync's rule, or the owner
 *  confirming a pair in settings. */
export async function mergeCopyInto(
  tx: DbOrTx,
  keepId: number,
  dropId: number,
  by: "sync" | "owner",
): Promise<void> {
  const f = schema.simplefinAccounts;
  const [copy] = await tx.select().from(f).where(eq(f.id, dropId));
  if (!copy) throw new Error(`SimpleFIN account ${dropId} not found`);
  const { moved, dropped } = await mergeCopy(tx, keepId, dropId);
  await tx
    .update(f)
    .set({
      externalAccountId: copy.externalAccountId,
      orgName: copy.orgName,
      accountName: copy.accountName,
      lastBalance: copy.lastBalance,
      lastBalanceDate: copy.lastBalanceDate,
      lastSeenAt: copy.lastSeenAt,
      // The owner merged a counted account: it stays counted.
      ...(by === "owner" ? { isIncluded: copy.isIncluded } : {}),
    })
    .where(eq(f.id, keepId));
  log("info", "simplefin_account_reidentified", {
    id: keepId,
    mergedId: dropId,
    rowsMoved: moved,
    rowsDropped: dropped,
    by,
  });
}

/** Every stored account as the pairing rules read it. */
export async function loadFeedIdentities(tx: DbOrTx) {
  const f = schema.simplefinAccounts;
  const stored = await tx
    .select({
      id: f.id,
      externalAccountId: f.externalAccountId,
      orgName: f.orgName,
      accountName: f.accountName,
      linkedPerformanceAccountId: f.linkedPerformanceAccountId,
      linkedSubKey: f.linkedSubKey,
      linkedLoanId: f.linkedLoanId,
      lastSeenAt: f.lastSeenAt,
      isIncluded: f.isIncluded,
      lastBalance: f.lastBalance,
    })
    .from(f);
  const firstHistory = await firstHistoryByAccount(tx);
  return stored.map((r) => ({
    ...r,
    lastBalance: Number(r.lastBalance),
    firstHistoryAt: firstHistory.get(r.id) ?? null,
  }));
}

/** Apply planReidentify. Returns the rows whose SimpleFIN id changed:
 *  they answered this sync, under their new id. */
export async function reidentifySimplefinAccounts(
  tx: DbOrTx,
  response: {
    accounts: readonly SimplefinAccount[];
    accountIdsWithErrors: readonly string[];
    errorScope: ErrorScope;
  },
  now: Date,
): Promise<Set<number>> {
  const f = schema.simplefinAccounts;
  const plan = planReidentify({
    stored: await loadFeedIdentities(tx),
    reported: response.accounts,
    erroredIds: new Set(response.accountIdsWithErrors),
    errorScope: response.errorScope,
    now,
  });
  const changed = new Set<number>();
  for (const a of plan.adopt) {
    await tx
      .update(f)
      .set({ externalAccountId: a.externalAccountId })
      .where(eq(f.id, a.rowId));
    changed.add(a.rowId);
    log("info", "simplefin_account_reidentified", { id: a.rowId, by: "sync" });
  }
  for (const m of plan.merge) {
    await mergeCopyInto(tx, m.keepId, m.dropId, "sync");
    changed.add(m.keepId);
  }
  for (const a of plan.ambiguous)
    log("warn", "simplefin_account_reidentify_ambiguous", {
      ids: a.ids,
      reason: a.reason,
    });
  return changed;
}
