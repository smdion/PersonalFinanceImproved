/**
 * Roth basis year lifecycle: picking each (account, owner) pair's current row and computing
 * a year-end finalize's roll-forward (live-then-finalized, like accountPerformance).
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
 * One (account, owner) pair's current row: the latest non-finalized row, else the latest
 * finalized one, so a finalize without a successor never drops a locked-in figure.
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

type SeedRothBasisRow = {
  performanceAccountId: number;
  ownerPersonId: number;
  year: number;
  contributionBasis: string;
  conversionBasis: string;
  latestConversionYear: number | null;
};

/**
 * A year's finalize: which non-finalized rows to finalize and which pairs need a seeded
 * next-year row. Row-driven (no row → never a $0 seed); existing next-year rows are kept.
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
