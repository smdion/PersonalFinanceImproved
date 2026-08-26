/**
 * Pure logic for the Roth basis year-scoped lifecycle: selecting the
 * "current" row per (account, owner) pair, and computing what a year-end
 * finalize needs to do to roll basis forward — mirrors the live-then-
 * finalized pattern accountPerformance/annualPerformance already use.
 */

export type RothBasisRollupRow = {
  id: number;
  performanceAccountId: number;
  ownerPersonId: number;
  year: number;
  contributionBasis: number;
  conversionBasis: number;
  latestConversionYear: number | null;
  isFinalized: boolean;
};

function pairKey(performanceAccountId: number, ownerPersonId: number): string {
  return `${performanceAccountId}|${ownerPersonId}`;
}

/**
 * Select the "current" row for a single (account, owner) pair from its full
 * row history: the latest non-finalized row if one exists, otherwise the
 * latest finalized row. Never returns nothing just because the most recent
 * finalize didn't seed a successor — that would silently drop a real,
 * locked-in basis figure back to "nothing entered."
 */
export function selectCurrentRothBasisRow(
  rowsForPair: RothBasisRollupRow[],
): RothBasisRollupRow | null {
  if (rowsForPair.length === 0) return null;
  const nonFinalized = rowsForPair.filter((r) => !r.isFinalized);
  const pool = nonFinalized.length > 0 ? nonFinalized : rowsForPair;
  return pool.reduce((latest, r) => (r.year > latest.year ? r : latest));
}

/**
 * Build a Map<"accountId|ownerId", RothBasisRollupRow> of the current row per
 * pair, from the full flat row history across all accounts/owners.
 * Selection is per-pair — different pairs can have different histories.
 */
export function buildCurrentRothBasisMap(
  allRows: RothBasisRollupRow[],
): Map<string, RothBasisRollupRow> {
  const byPair = new Map<string, RothBasisRollupRow[]>();
  for (const r of allRows) {
    const key = pairKey(r.performanceAccountId, r.ownerPersonId);
    const arr = byPair.get(key) ?? [];
    arr.push(r);
    byPair.set(key, arr);
  }
  const result = new Map<string, RothBasisRollupRow>();
  for (const [key, rows] of byPair) {
    const current = selectCurrentRothBasisRow(rows);
    if (current) result.set(key, current);
  }
  return result;
}

export type SeedRothBasisRow = {
  performanceAccountId: number;
  ownerPersonId: number;
  year: number;
  contributionBasis: string;
  conversionBasis: string;
  latestConversionYear: number | null;
};

/**
 * Compute what a finalize needs to do for one year's roll-forward:
 * - which currently-non-finalized rows at that year get marked finalized
 * - which (account, owner) pairs need a new seeded next-year row
 *
 * Row-driven, not account-driven: an account with no rothBasis row at all
 * is simply absent from `rowsAtYear` and never force-created at $0 (a
 * seeded zero would be indistinguishable from the user asserting real
 * basis is zero). A pair that already has a next-year row (entered before
 * this year was finalized) is skipped — never overwritten.
 */
export function computeRothBasisRollover(
  rowsAtYear: RothBasisRollupRow[],
  existingNextYearPairs: Set<string>,
): {
  idsToFinalize: number[];
  rowsToSeed: SeedRothBasisRow[];
} {
  const idsToFinalize = rowsAtYear.map((r) => r.id);
  const rowsToSeed = rowsAtYear
    .filter(
      (r) =>
        !existingNextYearPairs.has(
          pairKey(r.performanceAccountId, r.ownerPersonId),
        ),
    )
    .map((r) => ({
      performanceAccountId: r.performanceAccountId,
      ownerPersonId: r.ownerPersonId,
      year: r.year + 1,
      contributionBasis: r.contributionBasis.toFixed(2),
      conversionBasis: r.conversionBasis.toFixed(2),
      latestConversionYear: r.latestConversionYear,
    }));
  return { idsToFinalize, rowsToSeed };
}
