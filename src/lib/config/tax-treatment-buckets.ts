// Portfolio tax buckets as plain values, with no Zod, so the client
// projection cards and the engine can read them without bundling it.
import {
  PORTFOLIO_TAX_TYPE_VALUES,
  type PortfolioTaxType,
  type TaxTreatment,
} from "./enum-values";
import {
  type AccountCategory,
  getAccountTypeConfig,
  isKnownCategory,
  isTaxFreeBucket,
} from "./account-types";

/** A fresh zero counter per portfolio tax type. */
export function emptyTaxBucketMap(): Record<PortfolioTaxType, number> {
  return { preTax: 0, taxFree: 0, hsa: 0, afterTax: 0 };
}

/** A contribution's tax treatment → the portfolio tax type its money lands in. */
export const TAX_TREATMENT_TO_TAX_TYPE: Readonly<
  Record<TaxTreatment, PortfolioTaxType>
> = {
  pre_tax: "preTax",
  tax_free: "taxFree",
  after_tax: "afterTax",
  hsa: "hsa",
};

/** The portfolio tax type for a stored treatment; undefined for a value that
 *  isn't a tax treatment. */
export function portfolioTaxTypeOf(
  treatment: string,
): PortfolioTaxType | undefined {
  return isTaxTreatment(treatment)
    ? TAX_TREATMENT_TO_TAX_TYPE[treatment]
    : undefined;
}

// A key check, not taxTreatmentSchema: client code reads this file.
function isTaxTreatment(value: string): value is TaxTreatment {
  return Object.hasOwn(TAX_TREATMENT_TO_TAX_TYPE, value);
}

/** The side of a Roth-capable account a lump sum names (`LumpSum.taxType`). */
export type RothSplitSide = "traditional" | "roth";

/** A Roth-capable account's two tax parts, by side, as the engine's tax
 *  types: a side is converted here once and never compared with one. */
export const ROTH_SPLIT_PARTS: Readonly<
  Record<RothSplitSide, PortfolioTaxType>
> = {
  traditional: TAX_TREATMENT_TO_TAX_TYPE.pre_tax,
  roth: TAX_TREATMENT_TO_TAX_TYPE.tax_free,
};

/** The two tax parts of an account type that `supportsRothSplit`. */
export const SPLIT_TAX_TYPES: readonly PortfolioTaxType[] =
  Object.values(ROTH_SPLIT_PARTS);

/** The tax type of the part money on `side` lands in: in a Roth-capable
 *  account, that side's (Traditional unless Roth); otherwise the category's. */
export function taxTypeOnSide(
  category: AccountCategory,
  side: RothSplitSide | undefined,
): PortfolioTaxType {
  const { balanceStructure } = getAccountTypeConfig(category);
  if (balanceStructure === "roth_traditional")
    return ROTH_SPLIT_PARTS[side === "roth" ? "roth" : "traditional"];
  return balanceStructure === "single_bucket" ? "hsa" : "afterTax";
}

/** The tax type a stored row of `category` counts as: in a Roth-capable
 *  account, Roth only when stored tax-free, else Traditional; in any other,
 *  the account's one tax type; in a type this version doesn't know, as stored. */
export function bookedTaxType(
  category: AccountCategory,
  storedTaxType: string,
): PortfolioTaxType;
export function bookedTaxType<T extends string>(
  category: string,
  storedTaxType: T,
): T | PortfolioTaxType;
export function bookedTaxType(category: string, storedTaxType: string) {
  if (!isKnownCategory(category)) return storedTaxType;
  return taxTypeOnSide(
    category,
    isTaxFreeBucket(storedTaxType) ? "roth" : "traditional",
  );
}

/** The tax types a row of `accountType` can be saved with: those it counts
 *  as (`bookedTaxType`). */
export function taxTypesHeldBy(accountType: string): PortfolioTaxType[] {
  return PORTFOLIO_TAX_TYPE_VALUES.filter(
    (taxType) => bookedTaxType(accountType, taxType) === taxType,
  );
}
