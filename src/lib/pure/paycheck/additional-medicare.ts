/** Additional Medicare an employer withholds (IRC 3102(f)). */
import type { TaxBracketInput } from "./paycheck.types";

/**
 * Additional Medicare withheld on `wages`: the rate on the part of them past the threshold,
 * where `wagesThrough` is this employer's Medicare wages this year, these included.
 */
export function additionalMedicareWithheld(
  rates: Pick<
    TaxBracketInput,
    "medicareAdditionalRate" | "medicareAdditionalThreshold"
  >,
  wages: number,
  wagesThrough: number,
): number {
  return (
    rates.medicareAdditionalRate *
    Math.max(
      0,
      Math.min(wages, wagesThrough - rates.medicareAdditionalThreshold),
    )
  );
}
