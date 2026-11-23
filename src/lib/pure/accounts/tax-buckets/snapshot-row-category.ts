/** The category a snapshot row counts under. */
import type { AccountCategory } from "@/lib/config/account-types";

/** The stored facts a row's category reads. */
type SnapshotRowFacts = {
  performanceAccountId: number | null;
  subType: string | null;
  accountType: AccountCategory;
};

/** Each row with its category, in the rows' order: a sub-type row (Rollover,
 *  Employer Match, …) counts under its performance account's primary row's
 *  type. */
export function withRowCategories<R extends SnapshotRowFacts>(
  rows: readonly R[],
): { row: R; category: AccountCategory }[] {
  const primaryTypeByPerformanceAccountId = new Map<number, AccountCategory>();
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
