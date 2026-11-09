/** IRMAA: checks if MAGI crosses a Medicare surcharge cliff (age 65+). */
import {
  getIrmaaCost,
  getNextIrmaaCliff,
  type IrmaaBracket,
} from "../../config/irmaa-tables";
import type { ReturnFilingStatus } from "@/lib/config/filing-status";

export interface IrmaaInput {
  enableIrmaaAwareness: boolean | undefined;
  filingStatus: ReturnFilingStatus | null | undefined;
  /** Whether ANY household member is ≥65. */
  anyPersonAge65: boolean;
  /**
   * MAGI for IRMAA determination. Per IRS rules, year N IRMAA is based on
   * year N-2 MAGI. The orchestrator should pass the 2-year-lookback MAGI
   * when available, or current-year MAGI as a fallback for the first 2 years.
   */
  projectedMagi: number;
  /** Current-year Roth conversion amount (for cliff warning logic). */
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
    enableIrmaaAwareness,
    filingStatus,
    anyPersonAge65,
    projectedMagi,
    rothConversionAmount,
    irmaaBrackets,
  } = input;

  const warnings: string[] = [];

  if (!enableIrmaaAwareness || !filingStatus || !anyPersonAge65) {
    return { irmaaCost: 0, warnings };
  }

  // projectedMagi is the 2-year-lookback MAGI per IRS rules (or current-year fallback).
  const irmaaCost = getIrmaaCost(projectedMagi, filingStatus, irmaaBrackets);

  // If a Roth conversion pushed MAGI over a cliff, check whether less would
  // help. Lookback MAGI includes the conversion from 2 years ago; the first
  // 2 years fall back to current-year MAGI.
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
            `IRMAA: Roth conversion of $${rothConversionAmount.toFixed(0)} pushes MAGI over $${nextCliff.toLocaleString()} cliff — $${irmaaCost.toLocaleString()}/yr surcharge`,
          );
        }
      }
    }
  }

  return { irmaaCost, warnings };
}
