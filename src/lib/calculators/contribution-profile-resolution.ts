/**
 * Resolve which contribution profile applies to a given budget column — the
 * only function that should ever make this decision. A per-column override
 * (budget_profiles.columnContributionProfileIds) wins; otherwise the user's
 * global active contribution profile; otherwise null (Live/default).
 *
 * Both server-side budget item $ computation and client-side payroll
 * breakdown display must resolve this identically for the same column, or
 * the two numbers on screen silently disagree about which contribution
 * reality is in effect. Isomorphic (no I/O) so both sides can import it
 * directly instead of re-deriving the fallback inline.
 *
 * A columnContributionProfileIds array whose length doesn't match
 * numColumns (stale/mismatched shape) is treated as "no per-column
 * overrides at all" — every column falls through to the global default —
 * rather than silently indexing into a mismatched array.
 */
export function resolveContributionProfileId(
  columnContributionProfileIds: (number | null)[] | null | undefined,
  selectedColumn: number,
  numColumns: number,
  activeContribProfileId: number | null,
): number | null {
  const perColumn =
    columnContributionProfileIds &&
    columnContributionProfileIds.length === numColumns
      ? (columnContributionProfileIds[selectedColumn] ?? null)
      : null;
  return perColumn ?? activeContribProfileId ?? null;
}

/** Same resolution, for every column at once. */
export function resolveContributionProfileIdsForAllColumns(
  columnContributionProfileIds: (number | null)[] | null | undefined,
  numColumns: number,
  activeContribProfileId: number | null,
): (number | null)[] {
  return Array.from({ length: numColumns }, (_, i) =>
    resolveContributionProfileId(
      columnContributionProfileIds,
      i,
      numColumns,
      activeContribProfileId,
    ),
  );
}
