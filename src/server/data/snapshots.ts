/** Reads a portfolio snapshot with its accounts and total. */

import { eq, desc, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { AccountCategory } from "@/lib/config/account-types";
import { toNumber } from "@/lib/utils/numbers";
import type { Db } from "@/lib/db";

type SnapshotAccount = {
  institution: string;
  taxType: string;
  accountType: AccountCategory;
  subType: string | null;
  label: string | null;
  parentCategory: string | null;
  amount: number;
  ownerPersonId: number | null;
  performanceAccountId: number | null;
  displayName: string | null;
  accountLabel: string | null;
};

type SnapshotResult = {
  snapshot: typeof schema.portfolioSnapshots.$inferSelect;
  accounts: SnapshotAccount[];
  total: number;
};

/**
 * Fetch a specific snapshot by ID, or the latest if no ID is given.
 * Returns null if the snapshot doesn't exist.
 */
export async function getLatestSnapshot(
  db: Db,
  snapshotId?: number,
): Promise<SnapshotResult | null> {
  let snapshot: typeof schema.portfolioSnapshots.$inferSelect | undefined;
  if (snapshotId != null) {
    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .where(eq(schema.portfolioSnapshots.id, snapshotId))
      .limit(1);
    snapshot = rows[0];
  } else {
    const rows = await db
      .select()
      .from(schema.portfolioSnapshots)
      .orderBy(desc(schema.portfolioSnapshots.snapshotDate))
      .limit(1);
    snapshot = rows[0];
  }
  if (!snapshot) return null;

  const rawAccounts = await db
    .select({
      institution: schema.portfolioAccounts.institution,
      taxType: schema.portfolioAccounts.taxType,
      accountType: schema.portfolioAccounts.accountType,
      subType: schema.portfolioAccounts.subType,
      label: schema.portfolioAccounts.label,
      parentCategory: schema.portfolioAccounts.parentCategory,
      amount: schema.portfolioAccounts.amount,
      ownerPersonId: schema.portfolioAccounts.ownerPersonId,
      performanceAccountId: schema.portfolioAccounts.performanceAccountId,
      accountLabel: schema.performanceAccounts.accountLabel,
      displayName: schema.performanceAccounts.displayName,
      perfParentCategory: schema.performanceAccounts.parentCategory,
    })
    .from(schema.portfolioAccounts)
    .leftJoin(
      schema.performanceAccounts,
      eq(
        schema.portfolioAccounts.performanceAccountId,
        schema.performanceAccounts.id,
      ),
    )
    .where(eq(schema.portfolioAccounts.snapshotId, snapshot.id))
    // Stable insertion order — matches the Snapshot History panel
    // (networth.getSnapshots) so the latest snapshot reads the same on both
    // surfaces and doesn't reshuffle after an inline balance edit.
    .orderBy(asc(schema.portfolioAccounts.id));

  const accounts: SnapshotAccount[] = rawAccounts.map((a) => ({
    institution: a.institution,
    taxType: a.taxType,
    accountType: a.accountType as AccountCategory,
    subType: a.subType,
    label: a.label,
    // Prefer the master performance_account's parentCategory (authoritative)
    // over the snapshot row's denormalized copy. Falls back to the snapshot
    // row only when the portfolio account has no linked performance account
    // (LEFT JOIN miss — legitimate for accounts that aren't yet tracked).
    parentCategory: a.perfParentCategory ?? a.parentCategory,
    amount: toNumber(a.amount),
    ownerPersonId: a.ownerPersonId,
    performanceAccountId: a.performanceAccountId,
    displayName: a.displayName,
    accountLabel: a.accountLabel,
  }));
  const total = accounts.reduce(
    (s: number, a: SnapshotAccount) => s + a.amount,
    0,
  );

  return { snapshot, accounts, total };
}
