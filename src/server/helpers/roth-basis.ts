/**
 * Roth basis year-end rollover — called from performance.ts's finalizeYear
 * transaction (one line in the orchestrator; the actual logic is here and
 * in src/lib/pure/roth-basis-rollover.ts, per RULES.md's thin-orchestrator
 * rule). Mirrors accountPerformance's own finalize-then-seed-next-year
 * shape, but keyed as its own table since accountPerformance doesn't split
 * a jointly-labeled account per owner the way Roth basis correctness needs.
 */
import { eq, and } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "./transforms";
import { toNumber } from "./transforms";
import { computeRothBasisRollover } from "@/lib/pure/roth-basis-rollover";

/**
 * Finalize the given year's non-finalized rothBasis rows and seed next
 * year's rows carrying the same values forward. Safe to call even when no
 * rothBasis rows exist at all for this year (no-op) — an account that
 * never had basis entered stays absent, never force-created at $0.
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
