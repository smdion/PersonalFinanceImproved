/** Tax bucket → accumulation/decumulation slot mapping for the projection table: which slot field holds a bucket's contribution or withdrawal, and which specs and accounts belong to a bucket. */
import type { AccumulationSlot } from "@/lib/pure/engine/types";
import {
  getAllCategories,
  ACCOUNT_TYPE_CONFIG,
  isTaxFreeBucket,
  isPreTaxType,
} from "@/lib/config/account-types";
import { TAX_TREATMENT_TO_TAX_TYPE } from "@/lib/config/tax-treatment-buckets";

/** Tax bucket → slot field mapping. Data-driven: add a bucket here, everything else follows. */
export const bucketSlotMap: Record<
  string,
  {
    /** Which slot field holds the contribution for this bucket? */
    contributionField: "traditionalContrib" | "rothContrib" | "employeeContrib";
    /** Which slot field holds the withdrawal for this bucket? */
    withdrawalField: "traditionalWithdrawal" | "rothWithdrawal" | "withdrawal";
    /** Only match slots whose category is this value (null = all categories). */
    categoryFilter: string | null;
    /** DB tax treatment values that belong to this bucket (null = all). Derived from TAX_TREATMENT_TO_TAX_TYPE. */
    specTreatments: Set<string> | null;
    /** Tax field string for itemTaxType(). */
    taxField: string | undefined;
    /** True if employer match for this bucket is "associated" (flows to another tax bucket, e.g. Roth match → Pre-Tax). */
    matchIsAssociated: boolean;
  }
> = {
  preTax: {
    contributionField: "traditionalContrib",
    withdrawalField: "traditionalWithdrawal",
    categoryFilter: null,
    specTreatments: new Set(
      Object.entries(TAX_TREATMENT_TO_TAX_TYPE)
        .filter(([, v]) => isPreTaxType(v))
        .map(([k]) => k),
    ),
    taxField: "traditional",
    matchIsAssociated: false,
  },
  taxFree: {
    contributionField: "rothContrib",
    withdrawalField: "rothWithdrawal",
    categoryFilter: null,
    specTreatments: new Set(
      Object.entries(TAX_TREATMENT_TO_TAX_TYPE)
        .filter(([, v]) => isTaxFreeBucket(v))
        .map(([k]) => k),
    ),
    taxField: "roth",
    matchIsAssociated: true,
  },
  ...Object.fromEntries(
    getAllCategories()
      .filter((cat) => !ACCOUNT_TYPE_CONFIG[cat].supportsRothSplit)
      .map((cat) => [
        ACCOUNT_TYPE_CONFIG[cat].taxBucketKey,
        {
          contributionField: "employeeContrib" as const,
          withdrawalField: "withdrawal" as const,
          categoryFilter: cat,
          specTreatments: null,
          taxField: undefined,
          matchIsAssociated: false,
        },
      ]),
  ),
};

/** Set of categories that have their own tax buckets (not roth_traditional). */
export const _singleBucketCategories = new Set<string>(
  getAllCategories().filter(
    (cat) => !ACCOUNT_TYPE_CONFIG[cat].supportsRothSplit,
  ),
);

/** Get withdrawal amount for a tax bucket from a single slot. */
export function slotBucketWithdrawal(
  slot: {
    category: string;
    withdrawal: number;
    rothWithdrawal: number;
    traditionalWithdrawal: number;
  },
  bucket: string,
): number {
  const map = bucketSlotMap[bucket];
  if (!map) return 0;
  if (map.categoryFilter && slot.category !== map.categoryFilter) return 0;
  return slot[map.withdrawalField as keyof typeof slot] as number;
}

/** Get contribution amount for a tax bucket from a single slot. */
export function slotBucketContribution(
  slot: {
    category: string;
    traditionalContrib: number;
    rothContrib: number;
    employeeContrib: number;
  },
  bucket: string,
): number {
  const map = bucketSlotMap[bucket];
  if (!map) return 0;
  if (map.categoryFilter && slot.category !== map.categoryFilter) return 0;
  // preTax/taxFree don't apply to single-bucket categories (they have their own tax bucket)
  if (!map.categoryFilter && _singleBucketCategories.has(slot.category))
    return 0;
  return slot[map.contributionField as keyof typeof slot] as number;
}

/** Total balance inflow (employee + match) routed to a tax bucket — mirrors engine balance routing. */
export function slotsBucketBalanceInflow(
  slots: AccumulationSlot[],
  bucket: string,
): number {
  let total = 0;
  for (const slot of slots) {
    const emp = slotBucketContribution(slot, bucket);
    if (emp <= 0 && slot.employerMatch <= 0) continue;
    const map = bucketSlotMap[bucket];
    if (!map) continue;
    if (map.categoryFilter) {
      // Single-bucket (hsa, brokerage): employee + match both go to this bucket
      if (slot.category === map.categoryFilter)
        total += slot.employeeContrib + slot.employerMatch;
    } else if (!_singleBucketCategories.has(slot.category)) {
      // roth_traditional: preTax gets traditionalContrib + ALL match; taxFree gets rothContrib only
      if (map.contributionField === "traditionalContrib") {
        total += slot.traditionalContrib + slot.employerMatch;
      } else {
        total += slot.rothContrib;
      }
    }
  }
  return total;
}

/** Filter specs for a tax bucket — data-driven via bucketSlotMap + TAX_TREATMENT_TO_TAX_TYPE. */
export function filterSpecsForBucket<
  T extends { taxTreatment?: string; category?: string },
>(specs: T[], bucket: string): T[] {
  const map = bucketSlotMap[bucket];
  if (!map) return specs;
  // For buckets with a category filter (hsa, afterTax), only include matching specs
  if (map.categoryFilter)
    return specs.filter((s) => s.category === map.categoryFilter);
  // For preTax/taxFree (no category filter), exclude single-bucket categories
  // that have their own dedicated tax bucket (hsa, brokerage)
  const filtered = specs.filter(
    (s) => !s.category || !_singleBucketCategories.has(s.category),
  );
  if (!map.specTreatments) return filtered;
  return filtered.filter(
    (s) => s.taxTreatment != null && map.specTreatments!.has(s.taxTreatment),
  );
}

/** Filter individual accounts by tax bucket. ia.taxType already uses bucket names (preTax/taxFree/hsa/afterTax). */
export function iaBelongsToBucket(
  ia: { taxType: string },
  bucket: string,
): boolean {
  return ia.taxType === bucket;
}
