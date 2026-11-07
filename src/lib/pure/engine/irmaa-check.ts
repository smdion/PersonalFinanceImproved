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
  /**
   * IRMAA brackets grown to year N's vintage (the surcharge SCHEDULE
   * that applies this year, regardless of which year's MAGI it's
   * evaluated against — see `decumulation-year.ts`'s
   * `grownIrmaaBracketsForCheck`). NOT the same growth vintage as `RothConversionInput.irmaaBrackets` —
   * see that field's docblock for why the two differ. */
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

  // If Roth conversion pushed us over a cliff, check if reducing it helps.
  // Note: this warning uses the lookback MAGI which already includes the conversion
  // from 2 years ago. For the first 2 years we use current-year MAGI as fallback,
  // so the warning is still meaningful.
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
