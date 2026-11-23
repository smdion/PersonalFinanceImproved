/** A snapshot's money by booked tax type (`bookedTaxType`): all together, or
 *  by location (Retirement and Portfolio). */
import { isPortfolioParent } from "@/lib/config/account-types";
import { bookedTaxType } from "@/lib/config/tax-treatment-buckets";
import { withRowCategories } from "@/lib/pure/accounts/tax-buckets/snapshot-row-category";
import type { TaxBucketSnapshotAccount } from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import type { TaxLocationBreakdown } from "@/lib/pure/net-worth/year-end-rows";
import { toNumber } from "@/lib/utils/numbers";

/** The stored facts a row's booking reads; its account type `C` may be one
 *  this version doesn't know. */
type BookingFacts<C extends string> = Pick<
  TaxBucketSnapshotAccount,
  "taxType" | "subType" | "performanceAccountId"
> & { accountType: C };

/** The stored facts these sums read; a schema row or a loader row fits. */
type SnapshotRow<C extends string> = BookingFacts<C> &
  Pick<TaxBucketSnapshotAccount, "parentCategory"> & {
    amount: string | number;
  };

/** Each row with its booked tax type in place of its stored one, by the
 *  row's category (`withRowCategories`), in the rows' order. */
export function withBookedTaxTypes<C extends string, R extends BookingFacts<C>>(
  rows: readonly R[],
) {
  return withRowCategories(rows).map(({ row, category }) => ({
    ...row,
    taxType: bookedTaxType(category, row.taxType),
  }));
}

/** A snapshot's rows summed by booked tax type, every parent together. */
export function portfolioByTaxTypeFrom<C extends string>(
  snapshotRows: readonly SnapshotRow<C>[],
): Record<string, number> {
  const byTaxType: Record<string, number> = {};
  for (const { taxType, amount } of withBookedTaxTypes(snapshotRows))
    byTaxType[taxType] = (byTaxType[taxType] ?? 0) + toNumber(amount);
  return byTaxType;
}

/** A snapshot's rows summed by booked tax type, Portfolio-parented apart
 *  from the rest (Retirement). */
export function portfolioByTaxLocationFrom<C extends string>(
  snapshotRows: readonly SnapshotRow<C>[],
): TaxLocationBreakdown {
  const byLocation: TaxLocationBreakdown = { retirement: {}, portfolio: {} };
  for (const { parentCategory, taxType, amount } of withBookedTaxTypes(
    snapshotRows,
  )) {
    const bucket = isPortfolioParent(parentCategory ?? undefined)
      ? byLocation.portfolio
      : byLocation.retirement;
    bucket[taxType] = (bucket[taxType] ?? 0) + toNumber(amount);
  }
  return byLocation;
}
