/** A snapshot's money by tax type: all together, or by location
 *  (Retirement and Portfolio). */
import { isPortfolioParent } from "@/lib/config/account-types";
import type { TaxBucketSnapshotAccount } from "@/lib/pure/accounts/tax-buckets/tax-buckets";
import type { TaxLocationBreakdown } from "@/lib/pure/net-worth/year-end-rows";
import { toNumber } from "@/lib/utils/numbers";

/** The stored facts these sums read; a schema row or a loader row fits. */
type SnapshotRow = Pick<
  TaxBucketSnapshotAccount,
  "parentCategory" | "taxType"
> & { amount: string | number };

/** A snapshot's rows summed by tax type, every parent together. */
export function portfolioByTaxTypeFrom(
  snapshotRows: readonly SnapshotRow[],
): Record<string, number> {
  const byTaxType: Record<string, number> = {};
  for (const { taxType, amount } of snapshotRows)
    byTaxType[taxType] = (byTaxType[taxType] ?? 0) + toNumber(amount);
  return byTaxType;
}

/** A snapshot's rows summed by tax type, Portfolio-parented apart from the
 *  rest (Retirement). */
export function portfolioByTaxLocationFrom(
  snapshotRows: readonly SnapshotRow[],
): TaxLocationBreakdown {
  const byLocation: TaxLocationBreakdown = { retirement: {}, portfolio: {} };
  for (const { parentCategory, taxType, amount } of snapshotRows) {
    const bucket = isPortfolioParent(parentCategory ?? undefined)
      ? byLocation.portfolio
      : byLocation.retirement;
    bucket[taxType] = (bucket[taxType] ?? 0) + toNumber(amount);
  }
  return byLocation;
}
