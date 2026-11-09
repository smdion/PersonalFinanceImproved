/**
 * Roth basis year-end rollover, called from routers/performance's finalizeYear transaction.
 * Its own table because Roth basis is kept per owner, even on a jointly-labeled account.
 */
import { eq, and } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { toNumber } from "@/lib/utils/numbers";
import { computeRothBasisRollover } from "@/lib/pure/accounts/roth-basis-rollover";
import type { Db } from "@/lib/db";

/**
 * Finalize the year's non-finalized rothBasis rows and seed next year's with the same
 * values. A no-op without rows: an account with no basis is never created at $0.
 */
export async function finalizeRothBasisForYear(
  tx: Db,
  year: number,
): Promise<void> {
  const rowsAtYear = await tx
    .select()
    .from(schema.accountBasis)
    .where(
      and(
        eq(schema.accountBasis.year, year),
        eq(schema.accountBasis.isFinalized, false),
      ),
    );

  if (rowsAtYear.length === 0) return;

  const nextYear = year + 1;
  const existingNext = await tx
    .select({
      performanceAccountId: schema.accountBasis.performanceAccountId,
      ownerPersonId: schema.accountBasis.ownerPersonId,
    })
    .from(schema.accountBasis)
    .where(eq(schema.accountBasis.year, nextYear));
  const existingNextYearPairs = new Set(
    existingNext.map((r) => `${r.performanceAccountId}|${r.ownerPersonId}`),
  );

  const { idsToFinalize, rowsToSeed } = computeRothBasisRollover(
    rowsAtYear.map((r) => ({
      id: r.id,
      performanceAccountId: r.performanceAccountId,
      ownerPersonId: r.ownerPersonId,
      year: r.year,
      contributionBasis: toNumber(r.contributionBasis),
      conversionBasis: toNumber(r.conversionBasis),
      latestConversionYear: r.latestConversionYear,
      isFinalized: r.isFinalized,
    })),
    existingNextYearPairs,
  );

  for (const id of idsToFinalize) {
    await tx
      .update(schema.accountBasis)
      .set({ isFinalized: true })
      .where(eq(schema.accountBasis.id, id));
  }

  if (rowsToSeed.length > 0) {
    await tx
      .insert(schema.accountBasis)
      .values(
        rowsToSeed.map((r) => ({
          performanceAccountId: r.performanceAccountId,
          ownerPersonId: r.ownerPersonId,
          year: r.year,
          contributionBasis: r.contributionBasis,
          conversionBasis: r.conversionBasis,
          latestConversionYear: r.latestConversionYear,
          isSeeded: true,
        })),
      )
      .onConflictDoNothing();
  }
}
