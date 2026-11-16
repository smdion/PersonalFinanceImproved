/** Lump sums in the projection table: the tax bucket a lump sum lands in, and its per-bucket, per-category and total sums. */
import type { LumpSum } from "@/lib/pure/engine/types";
import type { AccountCategory } from "@/lib/config/account-types";
import { taxTypeOnSide } from "@/lib/config/tax-treatment-buckets";

type PortfolioTaxBucket = "preTax" | "taxFree" | "hsa" | "afterTax";

/** Determine which tax bucket a lump sum targets, using config-driven balance structure. */
export function lumpSumTaxBucket(ls: LumpSum): PortfolioTaxBucket {
  return taxTypeOnSide(ls.targetAccount, ls.taxType);
}

/** Sum lump sums targeting a specific tax bucket. */
export function lumpSumsForBucket(
  lumpSums: LumpSum[],
  bucket: PortfolioTaxBucket,
): LumpSum[] {
  return lumpSums.filter((ls) => lumpSumTaxBucket(ls) === bucket);
}

/** Sum lump sums targeting a specific account category. */
export function lumpSumsForCategory(
  lumpSums: LumpSum[],
  category: AccountCategory,
): LumpSum[] {
  return lumpSums.filter((ls) => ls.targetAccount === category);
}

/** Total dollar amount of lump sums. */
export function lumpSumTotal(lumpSums: LumpSum[]): number {
  return lumpSums.reduce((s, ls) => s + ls.amount, 0);
}
