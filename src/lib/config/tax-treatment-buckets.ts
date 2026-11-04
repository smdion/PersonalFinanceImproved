// Portfolio tax buckets as plain values, with no Zod, so the client
// projection cards and the engine can read them without bundling it.
import type { PortfolioTaxType, TaxTreatment } from "./enum-values";

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
