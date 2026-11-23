/** The category a snapshot row counts under. */

/** The stored facts a row's category reads; its account type `C` may be one
 *  this version doesn't know. */
type SnapshotRowFacts<C extends string> = {
  performanceAccountId: number | null;
  subType: string | null;
  accountType: C;
};

/** Each row with its category, in the rows' order: a sub-type row (Rollover,
 *  Employer Match, …) counts under its performance account's primary row's
 *  type. */
export function withRowCategories<
  C extends string,
  R extends SnapshotRowFacts<C>,
>(rows: readonly R[]): { row: R; category: R["accountType"] }[] {
  const primaryTypeByPerformanceAccountId = new Map<number, R["accountType"]>();
  for (const a of rows)
    if (a.performanceAccountId != null && !a.subType)
      primaryTypeByPerformanceAccountId.set(
        a.performanceAccountId,
        a.accountType,
      );
  return rows.map((a) => ({
    row: a,
    category:
      a.subType && a.performanceAccountId != null
        ? (primaryTypeByPerformanceAccountId.get(a.performanceAccountId) ??
          a.accountType)
        : a.accountType,
  }));
}
