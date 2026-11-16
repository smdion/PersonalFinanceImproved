/** IRMAA: checks if MAGI crosses a Medicare surcharge cliff (age 65+). */
import {
  getIrmaaCost,
  getNextIrmaaCliff,
  type IrmaaBracket,
} from "../../config/irmaa-tables";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

export interface IrmaaInput {
  filingStatus: ReturnFilingStatus | null | undefined;
  /** Whether ANY household member is ≥65. */
  anyPersonAge65: boolean;
  /** MAGI for IRMAA: year N reads tax year N−2's, or year N's own until recorded. */
  projectedMagi: number;
  /** The tax year `projectedMagi` is from (the warning names it). */
  magiTaxYear: number;
  /** The Roth conversion inside `projectedMagi`'s year (the cliff warning's). */
  rothConversionAmount: number;
  /** IRMAA brackets grown to year N's vintage (this year's surcharge schedule); a different
   *  vintage than `RothConversionInput.irmaaBrackets`, see that docblock. */
  irmaaBrackets: Record<string, IrmaaBracket[]>;
}

interface IrmaaResult {
  irmaaCost: number;
  warnings: string[];
}

/**
 * Check if projected MAGI crosses an IRMAA cliff (Medicare surcharge).
 * Reports cost and warns if Roth conversion pushed MAGI over a cliff.
 */
export function checkIrmaa(input: IrmaaInput): IrmaaResult {
  const {
    filingStatus,
    anyPersonAge65,
    projectedMagi,
    magiTaxYear,
    rothConversionAmount,
    irmaaBrackets,
  } = input;

  const warnings: string[] = [];

  // Computed for anyone 65+ (awareness only caps conversions).
  if (!filingStatus || !anyPersonAge65) {
    return { irmaaCost: 0, warnings };
  }

  const irmaaCost = getIrmaaCost(projectedMagi, filingStatus, irmaaBrackets);

  // If a Roth conversion pushed MAGI over a cliff, check whether less would
  // help. The conversion is the one in the year the MAGI was read from: two
  // years back, or this year's when the MAGI is this year's.
  if (rothConversionAmount > 0 && irmaaCost > 0) {
    const magiWithoutConversion = projectedMagi - rothConversionAmount;
    const irmaaCostWithout = getIrmaaCost(
      magiWithoutConversion,
      filingStatus,
      irmaaBrackets,
    );
    if (irmaaCostWithout < irmaaCost) {
      const nextCliff = getNextIrmaaCliff(
        magiWithoutConversion,
        filingStatus,
        irmaaBrackets,
      );
      if (nextCliff != null) {
        const maxConversionForCliff = Math.max(
          0,
          nextCliff - magiWithoutConversion,
        );
        if (maxConversionForCliff < rothConversionAmount) {
          warnings.push(
            `IRMAA: the ${magiTaxYear} Roth conversion of $${rothConversionAmount.toFixed(0)} pushed ${magiTaxYear} MAGI over the $${nextCliff.toLocaleString()} cliff — $${irmaaCost.toLocaleString()}/yr surcharge a person`,
          );
        }
      }
    }
  }

  return { irmaaCost, warnings };
}
